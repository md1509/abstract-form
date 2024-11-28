require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const sanitize = require('mongo-sanitize'); // Sanitize user inputs to prevent injection attacks
const path = require('path');  // Used to serve static files like HTML

const app = express();
app.use(bodyParser.json());
app.use(cors()); // To handle cross-origin requests

// Serve static files (like edit.html)
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB Atlas
mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Counter schema for auto-increment
const counterSchema = new mongoose.Schema({
    id: { type: String, required: true },
    seq: { type: Number, default: 0 },
});
const Counter = mongoose.model('Counter', counterSchema);

// Function to get the next sequence number
const getNextSequence = async (sequenceName) => {
    const counter = await Counter.findOneAndUpdate(
        { id: sequenceName },
        { $inc: { seq: 1 } },
        { new: true, upsert: true } // Create document if it doesn't exist
    );
    return counter.seq;
};

// Define the submission schema
const submissionSchema = new mongoose.Schema({
    submitterName: { type: String, required: true },
    submitterEmail: { type: String, required: true },
    abstractTitle: { type: String, required: true },
    abstractType: { type: String, required: true },
    theme: { type: String, required: true },
    company: { type: String, required: true },
    discipline: { type: String, required: true },
    authorNames: { type: String, required: true },
    abstractContent: { type: String, required: true },
    uniqueID: { type: Number, required: true }, // Sequential unique ID
    createdAt: { type: Date, default: Date.now },
});
const Submission = mongoose.model('Submission', submissionSchema);

// Configure Nodemailer with Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Use your App Password
    },
});

// Verify the Nodemailer configuration
transporter.verify((error) => {
    if (error) {
        console.error('Nodemailer error:', error);
    } else {
        console.log('Nodemailer is ready to send emails');
    }
});

// Health-check route for the server
app.get('/', (req, res) => {
    res.send('Server is running');
});

// API Endpoint to handle form submissions
app.post('/submit', async (req, res) => {
    const sanitizedSubmission = sanitize(req.body);

    const requiredFields = [
        'submitterName',
        'submitterEmail',
        'abstractTitle',
        'abstractType',
        'theme',
        'company',
        'discipline',
        'authorNames',
        'abstractContent',
    ];
    const missingFields = requiredFields.filter((field) => !sanitizedSubmission[field]);
    if (missingFields.length > 0) {
        return res.status(400).send({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    try {
        console.log('Incoming request:', sanitizedSubmission);

        // Generate a sequential unique ID
        const uniqueID = await getNextSequence('submissionID');
        sanitizedSubmission.uniqueID = uniqueID;

        // Save the submission to MongoDB
        const newSubmission = new Submission(sanitizedSubmission);
        await newSubmission.save();

        // Generate an edit link dynamically
        const editLink = `${req.protocol}://${req.get('host')}/edit?id=${uniqueID}`;

        // Log the edit link for debugging
        console.log("Edit link:", editLink);

        // Send confirmation email to the submitter
        const confirmationEmail = {
            from: process.env.EMAIL_USER,  // From the sender's email (configured in .env)
            to: sanitizedSubmission.submitterEmail, // To the user's email
            subject: 'Submission Confirmation',  // Subject of the email
            text: `Thank you for your submission! Your unique ID is ${uniqueID}.
            Edit your submission here: ${editLink}.
            Editing deadline: 2024-12-31.`,  // Email content
        };

        // Sending email
        try {
            await transporter.sendMail(confirmationEmail);
            console.log(`Confirmation email sent to: ${sanitizedSubmission.submitterEmail}`);
        } catch (emailError) {
            console.error(`Failed to send confirmation email to: ${sanitizedSubmission.submitterEmail}`, emailError);
        }

        // Notify the admin
        const adminEmail = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: 'New Submission Received',
            text: `A new abstract submission has been received:
            Submitter: ${sanitizedSubmission.submitterName}
            Title: ${sanitizedSubmission.abstractTitle}
            Check the admin dashboard for more details.`,
        };
        await transporter.sendMail(adminEmail);

        res.status(200).send({ message: 'Submission successful!', uniqueID });
    } catch (error) {
        console.error('Error handling submission:', error);
        res.status(500).send('An error occurred while processing your submission.');
    }
});

// API Endpoint to fetch a submission by uniqueID and render the form with data
// API Endpoint to fetch a submission by uniqueID and render the form with data
app.get('/edit', async (req, res) => {
    try {
        const { id } = req.query;

        // If no ID is provided in the query string, return a 400 error
        if (!id) {
            return res.status(400).json({ error: 'Unique ID is required in the query parameters.' });
        }

        // Convert the ID from string to a number
        const numericId = Number(id);
        if (isNaN(numericId)) {
            // If the ID is not a valid number, return a 400 error
            return res.status(400).json({ error: 'Invalid ID provided. ID must be a number.' });
        }

        // Query the database using the numeric ID
        const submission = await Submission.findOne({ uniqueID: numericId });

        // If no submission is found with the given ID, return a 404 error
        if (!submission) {
            return res.status(404).json({ error: `Submission with ID ${numericId} not found.` });
        }

        // Return the submission data as JSON
        res.status(200).json({
            submitterName: submission.submitterName,
            submitterEmail: submission.submitterEmail,
            abstractTitle: submission.abstractTitle,
            abstractType: submission.abstractType,
            company: submission.company,
            discipline: submission.discipline,
            authorNames: submission.authorNames,
            authorEmails: submission.authorEmails,
            authorPositions: submission.authorPositions,
            authorContact: submission.authorContact,
            abstractContent: submission.abstractContent
        });

    } catch (error) {
        console.error('Error in /edit endpoint:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching the submission.' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
