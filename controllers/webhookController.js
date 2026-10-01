const { OAuth2Client } = require("google-auth-library");
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const {
  calculateAccurateDuration,
  parseDurationMinutes,
  markStudentPresent,
  markStudentLeft,
  teacherCheckIn,
  teacherCheckOut,
} = require("../utils/classroom");
const {
  decodePubSubEnvelope,
  extractParticipantEmail,
  extractEventType,
  classifyMeetEvent,
  extractEventTime,
  resolveUserByEmail,
  findSessionForMeetEvent,
} = require("../utils/googleMeetWebhook");

const oidcClient = new OAuth2Client();

/**
 * Verify push authenticity:
 * 1) Shared secret query token (?token=GOOGLE_PUBSUB_TOKEN) — required when env is set
 * 2) Optional OIDC Bearer JWT when GOOGLE_PUBSUB_AUDIENCE is configured
 */
async function verifyPubSubRequest(req) {
  const expectedToken = process.env.GOOGLE_PUBSUB_TOKEN;
  if (expectedToken) {
    const provided = req.query.token || req.headers["x-goog-channel-token"];
    if (provided !== expectedToken) {
      const error = new Error("Invalid Pub/Sub verification token");
      error.statusCode = 401;
      error.code = "INVALID_PUBSUB_TOKEN";
      throw error;
    }
  }

  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  if (!audience) return { verified: Boolean(expectedToken), method: expectedToken ? "token" : "none" };

  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearer) {
    const error = new Error("Missing Pub/Sub OIDC bearer token");
    error.statusCode = 401;
    error.code = "MISSING_OIDC_TOKEN";
    throw error;
  }

  const ticket = await oidcClient.verifyIdToken({
    idToken: bearer,
    audience,
  });
  const claim = ticket.getPayload() || {};
  if (claim.email && claim.email !== "system@google.com" && !claim.email.endsWith(".gserviceaccount.com")) {
    // Accept Google Pub/Sub push service accounts / system identity
  }
  return { verified: true, method: "oidc+token", email: claim.email || null };
}

async function applyJoin(session, user) {
  if (user.role === "teacher") {
    const instructorId = String(session.instructor || session.teacher || "");
    if (instructorId !== String(user.profileId)) {
      return { applied: false, reason: "teacher_not_assigned" };
    }
    await teacherCheckIn(session);
    return { applied: true, action: "teacher_check_in" };
  }

  if (user.role === "student") {
    await markStudentPresent(session, user.profileId);
    return { applied: true, action: "student_check_in" };
  }

  return { applied: false, reason: "unsupported_role" };
}

async function applyLeave(session, user, eventTime) {
  const scheduledMins = parseDurationMinutes(session.duration);

  if (user.role === "teacher") {
    const instructorId = String(session.instructor || session.teacher || "");
    if (instructorId !== String(user.profileId)) {
      return { applied: false, reason: "teacher_not_assigned" };
    }
    await teacherCheckOut(session);
    return { applied: true, action: "teacher_check_out" };
  }

  if (user.role === "student") {
    await markStudentLeft(session, user.profileId);

    const refreshed = await Session.findById(session._id);
    const record = (refreshed?.studentAttendance || []).find(
      (r) => String(r.student) === String(user.profileId)
    );

    let duration = null;
    if (record) {
      duration = calculateAccurateDuration(
        record.intervals || [],
        refreshed.startTime,
        refreshed.endTime,
        scheduledMins
      );

      record.durationMinutes = duration.durationMinutes;
      record.durationFormatted = duration.durationFormatted;
      await refreshed.save();

      try {
        await Attendance.findOneAndUpdate(
          { student: user.profileId, session: refreshed._id },
          {
            course: refreshed.course,
            present: true,
            intervals: record.intervals || [],
            durationMinutes: duration.durationMinutes,
            durationFormatted: duration.durationFormatted,
            markedAt: eventTime,
          },
          { upsert: true }
        );
      } catch (err) {
        console.error("[Webhook] Attendance mirror update failed:", err.message);
      }
    }

    return {
      applied: true,
      action: "student_check_out",
      durationMinutes: duration?.durationMinutes || 0,
      durationFormatted: duration?.durationFormatted || "0 mins",
    };
  }

  return { applied: false, reason: "unsupported_role" };
}

/**
 * POST /api/webhooks/google-meet
 * Google Cloud Pub/Sub push endpoint for Meet join/leave events.
 *
 * ACK contract:
 * - 2xx  → message acknowledged (no retry)
 * - 4xx/5xx → Pub/Sub retries (except permanent 401 for bad token)
 */
exports.handleGoogleMeetWebhook = async (req, res) => {
  try {
    await verifyPubSubRequest(req);

    // Empty ping / subscription connectivity check
    if (!req.body || Object.keys(req.body).length === 0) {
      res.setHeader("X-EduHive-Webhook", "google-meet");
      return res.status(204).send();
    }

    const decoded = decodePubSubEnvelope(req.body);
    if (!decoded) {
      // Invalid envelope — ACK to avoid poison-message retries
      console.warn("[Webhook] Missing Pub/Sub message envelope");
      res.setHeader("X-EduHive-Webhook", "google-meet");
      return res.status(200).json({ received: true, ignored: true, reason: "no_message" });
    }

    const { payload, attributes, messageId } = decoded;
    const eventType = extractEventType(payload, attributes);
    const { isJoin, isLeave } = classifyMeetEvent(eventType);

    console.log(
      `[Webhook] msg=${messageId || "n/a"} type=${eventType || "(none)"} join=${isJoin} leave=${isLeave}`
    );

    if (!isJoin && !isLeave) {
      res.setHeader("X-EduHive-Webhook", "google-meet");
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: "unsupported_event",
        eventType,
      });
    }

    const participantEmail = extractParticipantEmail(payload, attributes);
    const session = await findSessionForMeetEvent(payload, attributes);

    if (!session) {
      console.warn("[Webhook] No matching LMS session for Meet event");
      res.setHeader("X-EduHive-Webhook", "google-meet");
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: "session_not_found",
        eventType,
        participantEmail,
      });
    }

    const user = await resolveUserByEmail(participantEmail);
    if (!user) {
      console.warn(`[Webhook] No LMS user for email: ${participantEmail || "(none)"}`);
      res.setHeader("X-EduHive-Webhook", "google-meet");
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: "user_not_found",
        eventType,
        participantEmail,
        sessionId: session._id,
      });
    }

    const eventTime = extractEventTime(payload, isLeave);
    let result;

    if (isJoin) {
      result = await applyJoin(session, user);
      console.log(
        `[Webhook] JOIN session=${session._id} user=${user.profileId} role=${user.role} ->`,
        result
      );
    } else {
      result = await applyLeave(session, user, eventTime);
      console.log(
        `[Webhook] LEAVE session=${session._id} user=${user.profileId} role=${user.role} ->`,
        result
      );
    }

    res.setHeader("X-EduHive-Webhook", "google-meet");
    return res.status(200).json({
      received: true,
      processed: Boolean(result?.applied),
      eventType,
      participantEmail,
      sessionId: session._id,
      role: user.role,
      profileId: user.profileId,
      ...result,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("[Webhook] Error:", err.message);

    // Auth failures must not ACK — return 401 so misconfigured endpoints are visible
    if (status === 401 || status === 403) {
      return res.status(status).json({
        received: false,
        message: err.message,
        code: err.code || "UNAUTHORIZED",
      });
    }

    // Transient processing errors → non-2xx so Pub/Sub retries
    return res.status(500).json({
      received: false,
      message: err.message || "Webhook processing failed",
    });
  }
};

/**
 * GET /api/webhooks/google-meet
 * Health / setup probe (Pub/Sub push uses POST; GET helps ops verify the route).
 */
exports.googleMeetWebhookHealth = (req, res) => {
  const hasToken = Boolean(process.env.GOOGLE_PUBSUB_TOKEN);
  const hasAudience = Boolean(process.env.GOOGLE_PUBSUB_AUDIENCE);
  res.status(200).json({
    ok: true,
    endpoint: "/api/webhooks/google-meet",
    method: "POST",
    verification: {
      queryTokenRequired: hasToken,
      oidcAudienceConfigured: hasAudience,
    },
    pushUrlHint: hasToken
      ? "/api/webhooks/google-meet?token=<GOOGLE_PUBSUB_TOKEN>"
      : "/api/webhooks/google-meet",
    events: [
      "conference.participant.joined",
      "conference.participant.left",
      "participant.v2.joined",
      "participant.v2.left",
      "participantSession.started",
      "participantSession.ended",
    ],
  });
};
