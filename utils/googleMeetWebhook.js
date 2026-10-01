const Session = require("../models/Session");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const Auth = require("../models/Auth");

/**
 * Decode a Google Cloud Pub/Sub push envelope into a Meet event payload.
 * Supports raw JSON body, base64 `message.data`, and Workspace Events wrappers.
 */
function decodePubSubEnvelope(body = {}) {
  // Direct JSON (local testing / some proxies)
  if (body && (body.type || body.eventType || body.participant || body.payload)) {
    return {
      messageId: body.messageId || null,
      publishTime: body.publishTime || null,
      attributes: body.attributes || {},
      payload: body.payload && typeof body.payload === "object" ? body.payload : body,
      rawText: null,
    };
  }

  const message = body.message;
  if (!message) {
    return null;
  }

  const attributes = message.attributes || {};
  let payload = null;
  let rawText = null;

  if (message.data) {
    rawText = Buffer.from(message.data, "base64").toString("utf8");
    try {
      const parsed = JSON.parse(rawText);
      // Workspace Events often nest under `payload`
      payload =
        parsed?.payload && typeof parsed.payload === "object"
          ? { ...parsed, ...parsed.payload }
          : parsed;
    } catch {
      payload = { raw: rawText };
    }
  }

  return {
    messageId: message.messageId || message.message_id || null,
    publishTime: message.publishTime || message.publish_time || null,
    attributes,
    payload: payload || {},
    rawText,
  };
}

function normalizeEmail(value) {
  if (!value || typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/**
 * Extract participant email from common Meet / Workspace event shapes.
 */
function extractParticipantEmail(payload = {}, attributes = {}) {
  const candidates = [
    payload?.participant?.signedinUser?.user,
    payload?.participant?.signedInUser?.user,
    payload?.participantSession?.participant?.signedinUser?.user,
    payload?.participantSession?.participant?.signedInUser?.user,
    payload?.signedinUser?.user,
    payload?.signedInUser?.user,
    payload?.participant?.email,
    payload?.user?.email,
    payload?.email,
    attributes.participantEmail,
    attributes.email,
  ];

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (email) return email;
  }
  return null;
}

function extractEventType(payload = {}, attributes = {}) {
  return String(
    payload.type ||
      payload["@type"] ||
      payload.eventType ||
      payload.event ||
      attributes.eventType ||
      attributes.type ||
      ""
  );
}

function classifyMeetEvent(eventType) {
  const type = String(eventType || "");
  const lower = type.toLowerCase();

  const isJoin =
    lower.includes("participant.v2.joined") ||
    lower.includes("participantsession.started") ||
    lower.includes("conference.participant.joined") ||
    lower.includes("participant.joined") ||
    (lower.includes("joined") && !lower.includes("left"));

  const isLeave =
    lower.includes("participant.v2.left") ||
    lower.includes("participantsession.ended") ||
    lower.includes("conference.participant.left") ||
    lower.includes("participant.left") ||
    lower.includes("left") ||
    (lower.includes("ended") && lower.includes("participant"));

  return { isJoin, isLeave };
}

function extractSpaceName(payload = {}, attributes = {}) {
  const candidates = [
    payload?.space?.name,
    payload?.meetingSpace?.name,
    payload?.conferenceRecord?.space?.name,
    payload?.conferenceRecord?.space,
    payload?.spaceName,
    attributes.space,
    attributes.spaceName,
  ];

  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value.name) return value.name;
  }
  return null;
}

function extractConferenceId(payload = {}, attributes = {}) {
  const spaceName = extractSpaceName(payload, attributes);
  if (spaceName && String(spaceName).includes("/")) {
    return String(spaceName).split("/").pop();
  }

  return (
    payload?.conferenceRecord?.name ||
    payload?.conferenceRecord?.conferenceId ||
    payload?.conferenceData?.conferenceId ||
    payload?.conferenceId ||
    attributes.conferenceId ||
    null
  );
}

function extractMeetCode(payload = {}, attributes = {}) {
  const linkCandidates = [
    payload?.meetingUri,
    payload?.space?.meetingUri,
    payload?.hangoutLink,
    payload?.meetingLink,
    attributes.meetingUri,
    attributes.meetLink,
  ];

  for (const link of linkCandidates) {
    if (!link || typeof link !== "string") continue;
    const match = link.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    if (match?.[1]) return match[1].toLowerCase();
  }

  const spaceName = extractSpaceName(payload, attributes);
  if (spaceName && !String(spaceName).startsWith("spaces/")) {
    return String(spaceName).toLowerCase();
  }
  return null;
}

function extractEventTime(payload = {}, isLeave = false) {
  const candidates = isLeave
    ? [
        payload?.participantSession?.endTime,
        payload?.participant?.endTime,
        payload?.endTime,
        payload?.eventTime,
      ]
    : [
        payload?.participantSession?.startTime,
        payload?.participant?.startTime,
        payload?.startTime,
        payload?.eventTime,
      ];

  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

/**
 * Resolve LMS user (teacher/student) from participant email.
 * Primary lookup is Auth.email (login email). Fallback: teacher.googleEmail.
 */
async function resolveUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const auth = await Auth.findOne({ email: normalized }).select(
    "role refId refModel email"
  );
  if (auth) {
    return {
      role: auth.role,
      profileId: auth.refId,
      email: auth.email,
      source: "auth",
    };
  }

  const teacher = await Teacher.findOne({ googleEmail: normalized }).select("_id");
  if (teacher) {
    return {
      role: "teacher",
      profileId: teacher._id,
      email: normalized,
      source: "teacher.googleEmail",
    };
  }

  const student = await Student.findOne({
    $or: [{ email: normalized }, { googleEmail: normalized }],
  }).select("_id");
  if (student) {
    return {
      role: "student",
      profileId: student._id,
      email: normalized,
      source: "student",
    };
  }

  return null;
}

/**
 * Match Meet event → LMS Session via space / conference / Meet code / link.
 */
async function findSessionForMeetEvent(payload = {}, attributes = {}) {
  const spaceName = extractSpaceName(payload, attributes);
  const conferenceId = extractConferenceId(payload, attributes);
  const meetCode = extractMeetCode(payload, attributes);

  if (spaceName) {
    const bySpace = await Session.findOne({ googleMeetSpace: spaceName });
    if (bySpace) return bySpace;
  }

  if (conferenceId) {
    const conf = String(conferenceId).replace(/^conferenceRecords\//, "");
    const byConference = await Session.findOne({
      $or: [
        { googleMeetSpace: `spaces/${conf}` },
        { googleMeetSpace: conf },
        { googleCalendarEventId: conf },
        { googleMeetSpace: conferenceId },
      ],
    });
    if (byConference) return byConference;
  }

  if (meetCode) {
    const byLink = await Session.findOne({
      $or: [
        { googleMeetLink: new RegExp(meetCode, "i") },
        { meetingLink: new RegExp(meetCode, "i") },
        { link: new RegExp(meetCode, "i") },
      ],
    }).sort({ startTime: -1 });
    if (byLink) return byLink;
  }

  // Last-resort: currently live/scheduled Meet session around now
  const now = Date.now();
  const recent = await Session.findOne({
    googleMeetLink: { $exists: true, $ne: "" },
    status: { $in: ["Scheduled", "pending", "ongoing"] },
    startTime: { $lte: new Date(now + 45 * 60 * 1000) },
    endTime: { $gte: new Date(now - 45 * 60 * 1000) },
  }).sort({ startTime: -1 });

  return recent;
}

module.exports = {
  decodePubSubEnvelope,
  extractParticipantEmail,
  extractEventType,
  classifyMeetEvent,
  extractSpaceName,
  extractConferenceId,
  extractMeetCode,
  extractEventTime,
  resolveUserByEmail,
  findSessionForMeetEvent,
};
