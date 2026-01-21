const nodemailer = require('nodemailer');

// Create transporter using SMTP settings from environment variables
const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration missing. Set SMTP_HOST, SMTP_USER and SMTP_PASS in your environment.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
};

const sendProviderEmail = async ({ subject, text, html, replyTo }) => {
  const transporter = createTransporter();
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER;
  const to = process.env.PROVIDER_TO || 's928641007@gmail.com';

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
    replyTo
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
};

module.exports = { sendProviderEmail };
