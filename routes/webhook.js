const express = require("express");
const {
  handleGoogleMeetWebhook,
  googleMeetWebhookHealth,
} = require("../controllers/webhookController");

const router = express.Router();

/**
 * Google Cloud Pub/Sub → Google Meet join/leave webhook
 *
 * Push endpoint (configure in GCP):
 *   POST https://<API_HOST>/api/webhooks/google-meet?token=<GOOGLE_PUBSUB_TOKEN>
 *
 * Security:
 *   - Shared secret query token (GOOGLE_PUBSUB_TOKEN)
 *   - Optional OIDC audience check (GOOGLE_PUBSUB_AUDIENCE = full push URL)
 *
 * ACK: return HTTP 2xx so Pub/Sub does not retry.
 */
router.get("/google-meet", googleMeetWebhookHealth);
router.post("/google-meet", handleGoogleMeetWebhook);

module.exports = router;
