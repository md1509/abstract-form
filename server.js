require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const sanitize = require('mongo-sanitize'); // Sanitize user inputs to prevent injection attacks

const app = express();
app.use(bodyParser.json());
app.use(cors()); // To handle cross-origin requests

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

        // Send confirmation email to the submitter
        const confirmationEmail = {
            from: process.env.EMAIL_USER,
            to: sanitizedSubmission.submitterEmail,
            subject: 'Submission Confirmation',
            text: `Thank you for your submission! Your unique ID is ${uniqueID}.
            Edit your submission here: ${editLink}.
            Editing deadline: 2024-12-31.`,
        };
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

// API Endpoint to fetch a submission by uniqueID
app.get('/edit', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).send({ error: 'Unique ID is required in the query parameters.' });
        }

        const submission = await Submission.findOne({ uniqueID: Number(id) }); // Convert ID to number
        if (!submission) {
            return res.status(404).send({ error: `Submission with ID ${id} not found.` });
        }

        res.status(200).send(submission);
    } catch (error) {
        console.error('Error in /edit endpoint:', error);
        res.status(500).send({ error: 'An unexpected error occurred while fetching the submission.' });
    }
});

// API Endpoint to update a submission
app.post('/update', async (req, res) => {
    const sanitizedRequest = sanitize(req.body);

    const { id, updatedData } = sanitizedRequest;
    if (!id || !updatedData) {
        return res.status(400).send({ error: 'Unique ID and updated data are required.' });
    }

    // Enforce editing deadline
    const deadline = new Date('2024-12-31');
    if (new Date() > deadline) {
        return res.status(403).send({ error: 'Editing deadline has passed.' });
    }

    try {
        const updatedSubmission = await Submission.findOneAndUpdate(
            { uniqueID: Number(id) },
            updatedData,
            { new: true } // Return the updated document
        );

        if (!updatedSubmission) {
            return res.status(404).send({ error: `Submission with ID ${id} not found.` });
        }

        // Send update confirmation email to the submitter
        const updateEmail = {
            from: process.env.EMAIL_USER,
            to: updatedSubmission.submitterEmail,
            subject: 'Submission Updated',
            text: `Your submission with ID ${id} has been successfully updated.`,
        };
        try {
            await transporter.sendMail(updateEmail);
            console.log(`Update email sent to: ${updatedSubmission.submitterEmail}`);
        } catch (emailError) {
            console.error(`Failed to send update email to: ${updatedSubmission.submitterEmail}`, emailError);
        }

        res.status(200).send({ message: 'Submission updated successfully!', updatedSubmission });
    } catch (error) {
        console.error('Error in /update endpoint:', error);
        res.status(500).send({ error: 'An error occurred while updating the submission.' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
