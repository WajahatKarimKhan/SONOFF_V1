const nodemailer = require('nodemailer');

// Configure the email transporter using your .env variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Verifies the transporter configuration and authentication.
 * Logs a success or error message to the console.
 */
const verifyConnection = async () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('Email credentials not set. Email functionality is disabled.');
        return;
    }
    try {
        await transporter.verify();
        console.log('✅ Email transporter is ready and authenticated successfully.');
    } catch (error) {
        console.error('❌ CRITICAL: Email transporter failed to authenticate. Check your EMAIL_USER and EMAIL_PASS in the environment variables.');
        console.error('Nodemailer Error:', error.message);
    }
};

/**
 * Sends an alert email.
 * @param {string} recipientEmail - The email address of the recipient.
 * @param {string} subject - The subject of the email.
 * @param {string} message - The plain text content of the email.
 */
const sendAlertEmail = async (recipientEmail, subject, message) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('Email credentials not set. Skipping email.');
    return;
  }

  const mailOptions = {
    from: `SONOFF Portal <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: subject,
    text: message,
    html: `<p>${message.replace(/\n/g, '<br>')}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email alert sent successfully to ${recipientEmail}`);
  } catch (error) {
    console.error(`Error sending email to ${recipientEmail}:`, error);
  }
};

module.exports = { sendAlertEmail, verifyConnection };

