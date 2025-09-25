const nodemailer = require('nodemailer');

// Explicitly configure the email transporter for Gmail
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465, // Use 465 for SSL, which is more reliable in cloud environments
  secure: true, // `true` for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // This must be the 16-character App Password with NO spaces
  },
});

/**
 * Verifies the email transporter configuration when the server starts.
 */
const verifyConnection = async () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️ Email credentials (EMAIL_USER or EMAIL_PASS) are not set. Email functionality is disabled.');
        return;
    }
    try {
        await transporter.verify();
        console.log('✅ Gmail email service is configured correctly and ready to send alerts.');
    } catch (error) {
        console.error('❌ CRITICAL: Gmail service failed to connect. Please check your credentials and network settings.');
        console.error('Nodemailer Error:', error.message);
    }
};

/**
 * Sends an alert email using the Gmail account.
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
    console.log(`🚀 Email alert sent successfully to ${recipientEmail} via Gmail.`);
  } catch (error) {
    console.error(`CRITICAL: Failed to send email to ${recipientEmail} via Gmail.`, error);
  }
};

module.exports = { sendAlertEmail, verifyConnection };

