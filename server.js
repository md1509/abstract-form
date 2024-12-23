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
app.get('/edit', async (req, res) => {
    try {
        const { id } = req.query;

        // Check if the ID is missing
        if (!id) {
            return res.status(400).json({ error: 'Unique ID is required in the query parameters.' });
        }

        const numericId = Number(id);
        if (isNaN(numericId)) {
            return res.status(400).json({ error: 'Invalid ID provided. ID must be a number.' });
        }

        // Query MongoDB to find the submission by uniqueID
        const submission = await Submission.findOne({ uniqueID: numericId });

        // If no submission is found with the given ID
        if (!submission) {
            return res.status(404).json({ error: `Submission with ID ${numericId} not found.` });
        }

        // HTML form populated with the data
        const editPage = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Edit Abstract Submission</title>
                <link rel="stylesheet" href="styles.css">
            </head>
            <body>
                <header class="form-header">
                    <img src="qatarenergy-logo.png" alt="QatarEnergy Logo" class="logo">
                    <h1>Edit Abstract Submission: 19th QatarEnergy LNG Engineering Conference</h1>
                </header>
                <div class="form-container">
                    <h1>Edit Your Abstract</h1>
                    <form id="edit-form" onsubmit="return handleUpdate(event)">
                        <input type="hidden" id="unique-id" name="uniqueID" value="${submission.uniqueID}">

                        <label for="submitter-name">Submitter Name<span class="required">*</span>:</label>
                        <input type="text" id="submitter-name" name="submitterName" value="${submission.submitterName}" required>

                        <label for="submitter-email">Submitter E-mail<span class="required">*</span>:</label>
                        <input type="email" id="submitter-email" name="submitterEmail" value="${submission.submitterEmail}" required>

                        <label for="abstract-title">Abstract Title<span class="required">*</span>:</label>
                        <input type="text" id="abstract-title" name="abstractTitle" value="${submission.abstractTitle}" required>

                        <!-- Abstract Type Dropdown -->
                        <label for="abstract-type">Abstract Type<span class="required">*</span>:</label>
                        <select id="abstract-type" name="abstractType" onchange="showAbstractOptions()" required>
                            <option value="technical-paper" ${submission.abstractType === 'technical-paper' ? 'selected' : ''}>Technical Paper</option>
                            <option value="poster" ${submission.abstractType === 'poster' ? 'selected' : ''}>Poster</option>
                        </select>

                        <!-- Technical Paper Themes -->
                        <div id="technical-paper-options" class="hidden options-box">
                            <p>Technical Paper Themes:</p>
                            <label>
                                <input type="radio" name="theme" value="Digitalization, Cyber Security & AI" ${submission.theme === 'Digitalization, Cyber Security & AI' ? 'checked' : ''}> Digitalization, Cyber Security & AI
                            </label><br>
                            <label>
                                <input type="radio" name="theme" value="Decarbonization Initiatives" ${submission.theme === 'Decarbonization Initiatives' ? 'checked' : ''}> Decarbonization Initiatives
                            </label><br>
                            <label>
                                <input type="radio" name="theme" value="Aging Facilities & Asset Life Extension" ${submission.theme === 'Aging Facilities & Asset Life Extension' ? 'checked' : ''}> Aging Facilities & Asset Life Extension
                            </label><br>
                            <label>
                                <input type="radio" name="theme" value="Energy Efficiency & Yield Improvement" ${submission.theme === 'Energy Efficiency & Yield Improvement' ? 'checked' : ''}> Energy Efficiency & Yield Improvement
                            </label>
                        </div>

                        <!-- Poster Themes -->
                        <div id="poster-options" class="hidden options-box">
                            <p>Poster Themes:</p>
                            <label>
                                <input type="radio" name="theme" value="Innovation, Technology & Sustainability" ${submission.theme === 'Innovation, Technology & Sustainability' ? 'checked' : ''}> Innovation, Technology & Sustainability
                            </label><br>
                            <label>
                                <input type="radio" name="theme" value="Integrity, Reliability & Process Safety" ${submission.theme === 'Integrity, Reliability & Process Safety' ? 'checked' : ''}> Integrity, Reliability & Process Safety
                            </label><br>
                            <label>
                                <input type="radio" name="theme" value="Optimization, Best Practices & Operations Excellence" ${submission.theme === 'Optimization, Best Practices & Operations Excellence' ? 'checked' : ''}> Optimization, Best Practices & Operations Excellence
                            </label>
                        </div>

                        <label for="company">Company<span class="required">*</span>:</label>
                        <input type="text" id="company" name="company" value="${submission.company}" required>

                        <label for="discipline">Discipline<span class="required">*</span>:</label>
                        <input type="text" id="discipline" name="discipline" value="${submission.discipline}" required>

                        <label for="abstract">Abstract (Max 350 words)<span class="required">*</span>:</label>
                        <textarea id="abstract" name="abstractContent" rows="5" required>${submission.abstractContent}</textarea>

                        <button type="submit">Update Submission</button>
                    </form>
                </div>
            </body>
            </html>
        `;

        res.send(editPage);

    } catch (error) {
        console.error('Error in /edit endpoint:', error);
        res.status(500).json({ error: 'An unexpected error occurred while fetching the submission.' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
