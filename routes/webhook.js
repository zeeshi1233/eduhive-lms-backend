const express = require('express');
const { handleGoogleMeetWebhook } = require('../controllers/webhookController');

const router = express.Router();

/**
 * POST /api/webhooks/google-meet
 * Google Cloud Pub/Sub push endpoint for Google Meet events.
 * No auth middleware — Google Pub/Sub pushes directly to this URL.
 * Security: validated by ?token= query param.
 */
router.post('/google-meet', handleGoogleMeetWebhook);

module.exports = router;
