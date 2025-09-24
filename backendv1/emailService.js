const nodemailer = require('nodemailer');

// Explicitly configure the email transporter for Gmail
// This is more reliable in cloud environments like Render
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465, // Use 465 for SSL, which is generally more reliable than 587 with STARTTLS
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Make sure this is the 16-character App Password with no spaces
  },
});

/**
 * Verifies the transporter configuration and authentication on startup.
 */
const verifyConnection = async () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️ Email credentials (EMAIL_USER or EMAIL_PASS) are not set in the environment. Email functionality is disabled.');
        return;
    }
    try {
        await transporter.verify();
        console.log('✅ Email service is configured correctly and ready to send alerts.');
    } catch (error) {
        console.error('❌ CRITICAL: Email service failed to connect. Please check your credentials and network settings.');
        console.error('Nodemailer Error:', error.message);
    }
};


/**
 * Sends an alert email.
 * @param {string} recipientEmail The email address to send the alert to.
 * @param {string} subject The subject line of the email.
 * @param {string} message The plain text message for the email.
 */
const sendAlertEmail = async (recipientEmail, subject, message) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return; // Already warned on startup
  }

  const mailOptions = {
    from: `SONOFF Portal <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: subject,
    text: message,
    html: `<p><b>SONOFF Device Alert:</b></p><p>${message.replace(/\n/g, '<br>')}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`🚀 Email alert sent successfully to ${recipientEmail}`);
  } catch (error) {
    console.error(`CRITICAL: Failed to send email to ${recipientEmail}.`, error);
  }
};

module.exports = { sendAlertEmail, verifyConnection };
