const nodemailer = require('nodemailer');

// Explicitly configure the email transporter for Outlook/Office 365.
const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com', // Outlook's SMTP server
  port: 587, // Standard port for secure SMTP
  secure: false, // `false` because port 587 uses STARTTLS
  auth: {
    user: process.env.EMAIL_USER, // Your full Outlook email address
    pass: process.env.EMAIL_PASS, // Your Outlook password or an App Password
  },
  requireTLS: true // Enforce TLS
});

/**
 * Verifies the email transporter configuration and authentication when the server starts.
 */
const verifyConnection = async () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️ Email credentials (EMAIL_USER or EMAIL_PASS) are not set. Email functionality is disabled.');
        return;
    }
    try {
        await transporter.verify();
        console.log('✅ Outlook email service is configured correctly and ready to send alerts.');
    } catch (error) {
        console.error('❌ CRITICAL: Outlook email service failed to connect. Please check your credentials and network settings.');
        console.error('Nodemailer Error:', error.message);
    }
};


/**
 * Sends an alert email using the Outlook account.
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
    console.log(`🚀 Email alert sent successfully to ${recipientEmail} via Outlook.`);
  } catch (error) {
    console.error(`CRITICAL: Failed to send email to ${recipientEmail} via Outlook.`, error);
  }
};

module.exports = { sendAlertEmail, verifyConnection };

