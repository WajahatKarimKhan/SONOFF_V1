const nodemailer = require('nodemailer');

// Configure the email transporter using your .env variables
const transporter = nodemailer.createTransport({
  service: 'gmail', // Or another email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends an alert email.
 * @param {string} recipientEmail - The email address of the recipient.
 * @param {string} subject - The subject of the email.
 * @param {string} message - The plain text content of the email.
 */
const sendAlertEmail = async (recipientEmail, subject, message) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('EMAIL_USER or EMAIL_PASS not set in .env file. Skipping email.');
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: recipientEmail,
    subject: subject,
    text: message,
    html: `<p>${message.replace(/\n/g, '<br>')}</p>`, // Simple HTML version
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${recipientEmail}`);
  } catch (error) {
    console.error(`Error sending email to ${recipientEmail}:`, error);
  }
};

module.exports = { sendAlertEmail };

