const Session = require('../models/Session');
const Student = require('../models/Student');

/**
 * POST /api/webhooks/google-meet
 * Receives Google Cloud Pub/Sub push notifications for Meet events.
 * Handles participant join/leave to auto-update attendance checkout times.
 * IMPORTANT: Always return 200 immediately to acknowledge the Pub/Sub message.
 */
exports.handleGoogleMeetWebhook = async (req, res) => {
  // Acknowledge Pub/Sub IMMEDIATELY to prevent re-delivery
  res.status(200).json({ received: true });

  try {
    // Optional: verify the token to ensure requests come from Google
    const token = req.query.token;
    if (process.env.GOOGLE_PUBSUB_TOKEN && token !== process.env.GOOGLE_PUBSUB_TOKEN) {
      console.warn('[Webhook] Invalid Pub/Sub token — request rejected silently.');
      return;
    }

    const message = req.body?.message;
    if (!message?.data) {
      console.log('[Webhook] No Pub/Sub message data found.');
      return;
    }

    // Decode base64 payload
    const rawPayload = Buffer.from(message.data, 'base64').toString('utf8');
    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      console.error('[Webhook] Failed to parse Pub/Sub payload:', rawPayload);
      return;
    }

    const eventType = payload.type || payload['@type'] || '';
    console.log('[Webhook] Google Meet event received:', eventType, JSON.stringify(payload).slice(0, 200));

    // ── Handle participant LEFT event ──────────────────────────────────────
    if (
      eventType.includes('participant.v2.left') ||
      eventType.includes('participantSession.ended')
    ) {
      const participantEmail = payload.participant?.signedinUser?.user
        || payload.participantSession?.participant?.signedinUser?.user
        || null;

      const endTime = payload.participantSession?.endTime
        || payload.participant?.endTime
        || new Date().toISOString();

      const spaceName = payload.space?.name
        || payload.conferenceRecord?.space
        || null;

      if (!spaceName) {
        console.warn('[Webhook] Could not find spaceName in payload.');
        return;
      }

      // Find the session by googleMeetSpace field
      const session = await Session.findOne({ googleMeetSpace: spaceName });
      if (!session) {
        console.warn(`[Webhook] No session found for space: ${spaceName}`);
        return;
      }

      const now = new Date(endTime);

      // ── Teacher checkout ──
      const instructorEmailMatch = participantEmail &&
        session.teacherAttendance?.checkInTime &&
        !session.teacherAttendance?.checkOutTime;

      if (instructorEmailMatch) {
        // Try to match by teacher's email if stored, otherwise treat first left as teacher
        session.set('teacherAttendance.checkOutTime', now);
        
        // Calculate duration
        const checkIn = new Date(session.teacherAttendance.checkInTime);
        const durationMs = now - checkIn;
        const durationMins = Math.round(durationMs / 60000);
        const h = Math.floor(durationMins / 60);
        const m = durationMins % 60;
        const durationFormatted = h > 0 ? `${h}h ${m}m` : `${m} mins`;
        
        session.set('teacherAttendance.durationMinutes', durationMins);
        session.set('teacherAttendance.durationFormatted', durationFormatted);
        
        console.log(`[Webhook] Teacher checkout recorded for session ${session._id}: ${durationFormatted}`);
      }

      // ── Student checkout ──
      if (Array.isArray(session.studentAttendance)) {
        let updated = false;
        
        // Try to match by email if participantEmail is available
        if (participantEmail) {
          // Find student by email from Student model
          const student = await Student.findOne({ 
            $or: [
              { email: participantEmail },
              { googleEmail: participantEmail }
            ]
          }).select('_id');

          if (student) {
            const record = session.studentAttendance.find(
              r => String(r.student) === String(student._id) && r.present && !r.leftAt
            );
            if (record) {
              record.leftAt = now;
              
              if (record.joinedAt) {
                const durationMs = now - new Date(record.joinedAt);
                const mins = Math.round(durationMs / 60000);
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                record.durationMinutes = mins;
                record.durationFormatted = h > 0 ? `${h}h ${m}m` : `${m} mins`;
              }
              updated = true;
              console.log(`[Webhook] Student ${student._id} checkout recorded at ${now.toISOString()}`);
            }
          }
        }

        if (!updated) {
          // Fallback: update the first student who is present and hasn't left yet
          const record = session.studentAttendance.find(r => r.present && !r.leftAt);
          if (record) {
            record.leftAt = now;
            if (record.joinedAt) {
              const durationMs = now - new Date(record.joinedAt);
              const mins = Math.round(durationMs / 60000);
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              record.durationMinutes = mins;
              record.durationFormatted = h > 0 ? `${h}h ${m}m` : `${m} mins`;
            }
            console.log(`[Webhook] Fallback student checkout recorded.`);
          }
        }
      }

      await session.save();
      console.log(`[Webhook] Session ${session._id} attendance updated successfully.`);
      return;
    }

    // ── Handle participant JOINED event ────────────────────────────────────
    if (
      eventType.includes('participant.v2.joined') ||
      eventType.includes('participantSession.started')
    ) {
      const spaceName = payload.space?.name || payload.conferenceRecord?.space || null;
      if (!spaceName) return;

      const session = await Session.findOne({ googleMeetSpace: spaceName });
      if (!session) return;

      const joinTime = payload.participantSession?.startTime || new Date().toISOString();
      const participantEmail = payload.participant?.signedinUser?.user || null;

      console.log(`[Webhook] Participant joined: ${participantEmail} at ${joinTime} for session ${session._id}`);
      // Join time is already tracked by the platform's /api/classroom/join endpoint
      // This is just for logging / future use
      return;
    }

    console.log('[Webhook] Unhandled event type:', eventType);
  } catch (err) {
    // Never let errors propagate — Pub/Sub already acknowledged above
    console.error('[Webhook] Error processing Google Meet event:', err.message, err.stack);
  }
};
