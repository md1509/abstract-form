require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors()); // To handle cross-origin requests

// Connect to MongoDB Atlas
mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch((err) => console.error('MongoDB connection error:', err));

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
    uniqueID: { type: String, required: true },
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
transporter.verify((error, success) => {
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
    try {
        console.log('Incoming request:', req.body);

        const submission = req.body;

        // Generate a unique ID for this submission
        const uniqueID = Math.random().toString(36).substr(2, 9);
        submission.uniqueID = uniqueID;

        // Save the submission to MongoDB
        const newSubmission = new Submission(submission);
        await newSubmission.save();

        // Generate an edit link dynamically
        const editLink = `${req.protocol}://${req.get('host')}/edit?id=${uniqueID}`;

        // Send confirmation email to the submitter
        const confirmationEmail = {
            from: process.env.EMAIL_USER,
            to: submission.submitterEmail,
            subject: 'Submission Confirmation',
            text: `Thank you for your submission! Your unique ID is ${uniqueID}.
            Edit your submission here: ${editLink}.
            Editing deadline: 2024-12-31.`,
        };
        await transporter.sendMail(confirmationEmail);

        // Notify the admin
        const adminEmail = {
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: 'New Submission Received',
            text: `A new abstract submission has been received:
            Submitter: ${submission.submitterName}
            Title: ${submission.abstractTitle}
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
            return res.status(400).send({ error: 'Unique ID is required' });
        }

        const submission = await Submission.findOne({ uniqueID: id });
        if (!submission) {
            return res.status(404).send({ error: 'Submission not found' });
        }

        res.status(200).send(submission);
    } catch (error) {
        console.error('Error in /edit endpoint:', error);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
