// emailService.js - Now supports both SendGrid and Gmail

const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

// --- Service Initialization ---
let isSendGridInitialized = false;
let isGmailInitialized = false;
let gmailTransporter;

// 1. Initialize SendGrid
if (process.env.SENDGRID_API_KEY && process.env.EMAIL_USER) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  isSendGridInitialized = true;
  console.log('✅ SendGrid email service is configured.');
} else {
  console.warn('⚠️ SendGrid credentials not set. SendGrid is disabled.');
}

// 2. Initialize Gmail (Nodemailer)
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  gmailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER, // Your Gmail address
      pass: process.env.EMAIL_PASS, // Your 16-character Gmail App Password
    },
    connectionTimeout: 10000,
  });
  // We don't verify here to avoid startup delays, but will log errors on send.
  isGmailInitialized = true;
  console.log('✅ Gmail (Nodemailer) service is configured.');
} else {
  console.warn('⚠️ Gmail credentials (EMAIL_PASS) not set. Gmail is disabled.');
}


/**
 * The main email sending function.
 * It will attempt to send an email using every service that has been successfully initialized.
 */
const sendAlertEmail = async (recipientEmail, subject, message) => {
  if (!isSendGridInitialized && !isGmailInitialized) {
    console.error('❌ No email services are configured. Cannot send alert.');
    return;
  }

  // --- Attempt to send with SendGrid ---
  if (isSendGridInitialized) {
    const msg = {
      to: recipientEmail,
      from: {
        name: 'SONOFF Alerts (SendGrid)',
        email: process.env.EMAIL_USER, // The verified sender
      },
      subject: subject,
      html: `<p><b>SONOFF Device Alert:</b></p><p>${message.replace(/\n/g, '<br>')}</p>`,
    };
    try {
      await sgMail.send(msg);
      console.log(`🚀 Email alert sent successfully to ${recipientEmail} via SendGrid.`);
    } catch (error) {
      console.error(`❌ CRITICAL: Failed to send email via SendGrid.`, error.response?.body || error.message);
    }
  }

  // --- Attempt to send with Gmail (Nodemailer) ---
  if (isGmailInitialized) {
    const mailOptions = {
      from: `SONOFF Alerts (Gmail) <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: subject,
      html: `<p><b>SONOFF Device Alert:</b></p><p>${message.replace(/\n/g, '<br>')}</p>`,
    };
    try {
      await gmailTransporter.sendMail(mailOptions);
      console.log(`🚀 Email alert sent successfully to ${recipientEmail} via Gmail.`);
    } catch (error) {
      console.error(`❌ CRITICAL: Failed to send email via Gmail.`, error.message);
    }
  }
};

module.exports = { sendAlertEmail };
