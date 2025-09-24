const nodemailer = require('nodemailer');

// Configure the email transporter using credentials from the .env file
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or another service like 'outlook'
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends an alert email.
 * @param {string} recipientEmail The email address to send the alert to.
 * @param {string} subject The subject line of the email.
 * @param {string} message The plain text message for the email.
 */
const sendAlertEmail = async (recipientEmail, subject, message) => {
  // Check if credentials are loaded before trying to send
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Email credentials not found in .env file. Cannot send email.');
    return;
  }

  const mailOptions = {
    from: `SONOFF Portal <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: subject,
    text: message,
    html: `<p><b>SONOFF Device Alert:</b></p><p>${message.replace(/\n/g, '<br>')}</p>`, // A simple HTML version of the message
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Successfully sent email alert to ${recipientEmail}`);
  } catch (error) {
    console.error(`CRITICAL: Failed to send email to ${recipientEmail}. Check your credentials and connection.`, error);
  }
};

module.exports = { sendAlertEmail };

