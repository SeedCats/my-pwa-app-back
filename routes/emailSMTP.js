const express = require('express');
const router = express.Router();
const { sendProviderEmail } = require('../config/mailer');

// POST /api/provider/request
// Expected JSON body: { name, email, subject, message }
router.post('/request', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'name, email, subject and message are required' });
    }

    const html = `
      <p>You have a new provider request from the Health Monitoring System:</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong></p>
      <p>${message.replace(/\n/g, '<br/>')}</p>
      <br></br>
      <p>Sent at: ${new Date().toISOString()}</p>
    `;

    const info = await sendProviderEmail({
      subject: `[Provider Request] ${subject}`,
      text: `From: ${name} <${email}>\n\n${message}`,
      html,
      replyTo: email
    });

    return res.status(200).json({ success: true, message: 'Request sent', info });
  } catch (err) {
    console.error('Provider email error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send request', error: err.message });
  }
});

module.exports = router;
