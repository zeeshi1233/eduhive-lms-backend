const crypto = require("crypto");
const { google } = require("googleapis");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function getRedirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:5000/api/google/callback"
  );
}

function getGoogleOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
  }
  return oauth2Client;
}

function formatDuration(minutes) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return "0 mins";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) {
    return `${h} hr${h > 1 ? "s" : ""} ${m} min${m !== 1 ? "s" : ""}`;
  }
  return `${m} min${m !== 1 ? "s" : ""}`;
}

/**
 * Build an OAuth client from a teacher document (or env admin refresh token).
 */
async function getAuthClientForTeacher(teacher) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );

  const refreshToken =
    teacher?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN || "";

  if (!refreshToken) {
    throw new Error(
      "No Google refresh token available. Connect a Google account first."
    );
  }

  const credentials = {
    refresh_token: refreshToken,
  };
  if (teacher?.googleAccessToken) {
    credentials.access_token = teacher.googleAccessToken;
  }
  if (teacher?.googleTokenExpiry) {
    credentials.expiry_date = new Date(teacher.googleTokenExpiry).getTime();
  }

  oauth2Client.setCredentials(credentials);

  // Persist refreshed access tokens back onto the teacher when available
  oauth2Client.on("tokens", async (tokens) => {
    if (!teacher?._id) return;
    try {
      const Teacher = require("../models/Teacher");
      const update = {};
      if (tokens.access_token) update.googleAccessToken = tokens.access_token;
      if (tokens.refresh_token) update.googleRefreshToken = tokens.refresh_token;
      if (tokens.expiry_date) {
        update.googleTokenExpiry = new Date(tokens.expiry_date);
      }
      if (Object.keys(update).length) {
        await Teacher.findByIdAndUpdate(teacher._id, update);
      }
    } catch (err) {
      console.warn("[GoogleOAuth] Failed to persist refreshed tokens:", err.message);
    }
  });

  return oauth2Client;
}

/**
 * Create a Calendar event with an official Google Meet link (hangoutLink).
 * Preferred path for session creation — works with teacher or admin OAuth.
 */
async function createCalendarMeetEvent({
  teacher,
  title,
  startTime,
  endTime,
  description = "",
  attendeeEmails = [],
}) {
  const auth = await getAuthClientForTeacher(teacher);
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(startTime);
  const end = endTime
    ? new Date(endTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid startTime/endTime for Google Calendar event");
  }

  const requestId = crypto.randomUUID();
  const uniqueAttendees = [
    ...new Set(
      (attendeeEmails || [])
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
    ),
  ].map((email) => ({ email }));

  const response = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: uniqueAttendees.length ? "all" : "none",
    requestBody: {
      summary: title || "EduHive Class",
      description: description || "EduHive LMS virtual class",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: uniqueAttendees,
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const event = response.data || {};
  const videoEntry = (event.conferenceData?.entryPoints || []).find(
    (e) => e.entryPointType === "video"
  );
  const meetingUri = event.hangoutLink || videoEntry?.uri || "";
  const conferenceId = event.conferenceData?.conferenceId || "";

  if (!meetingUri) {
    throw new Error("Google Calendar event created but no Meet link returned");
  }

  return {
    meetingUri,
    hangoutLink: meetingUri,
    spaceName: conferenceId ? `spaces/${conferenceId}` : "",
    calendarEventId: event.id || "",
    hostedByTeacher: Boolean(teacher?.googleRefreshToken),
  };
}

/**
 * Fallback: Create a Google Meet Space via Meet REST API.
 */
async function createGoogleMeetSpace() {
  try {
    const oauth2Client = getGoogleOAuthClient();
    const meet = google.meet({ version: "v2", auth: oauth2Client });

    const response = await meet.spaces.create({
      requestBody: {
        config: {
          accessType: "OPEN",
        },
      },
    });

    return {
      spaceName: response.data.name,
      meetingUri: response.data.meetingUri,
    };
  } catch (error) {
    console.error("Failed to create Google Meet Space:", error.message);
    throw new Error(
      "Could not generate Google Meet link. Please ensure Google Workspace is connected."
    );
  }
}

async function createGoogleMeetSpaceForTeacher(teacher) {
  const refreshToken =
    teacher?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error(
      "No Google refresh token available. Please connect your Google account or contact admin."
    );
  }

  try {
    const oauth2Client = await getAuthClientForTeacher(teacher);
    const meet = google.meet({ version: "v2", auth: oauth2Client });
    const response = await meet.spaces.create({
      requestBody: {
        config: {
          accessType: "OPEN",
        },
      },
    });

    return {
      spaceName: response.data.name,
      meetingUri: response.data.meetingUri,
      hostedByTeacher: !!teacher?.googleRefreshToken,
    };
  } catch (error) {
    console.error(
      "Failed to create Google Meet Space for teacher:",
      error.message
    );
    if (teacher?.googleRefreshToken && process.env.GOOGLE_REFRESH_TOKEN) {
      console.log("Falling back to admin token for Meet creation...");
      return createGoogleMeetSpace();
    }
    throw new Error(
      "Could not generate Google Meet link. Please ensure Google account is connected."
    );
  }
}

/**
 * Preferred session Meet creator: Calendar event first, then Meet Spaces fallback.
 */
async function createSessionGoogleMeet({
  teacher,
  title,
  startTime,
  endTime,
  description,
  attendeeEmails,
}) {
  try {
    return await createCalendarMeetEvent({
      teacher,
      title,
      startTime,
      endTime,
      description,
      attendeeEmails,
    });
  } catch (calendarErr) {
    console.warn(
      "[GoogleMeet] Calendar Meet creation failed, trying Spaces API:",
      calendarErr.message
    );
    const space = await createGoogleMeetSpaceForTeacher(teacher);
    return {
      ...space,
      hangoutLink: space.meetingUri,
      calendarEventId: "",
    };
  }
}

async function syncGoogleMeetAttendance(spaceName) {
  try {
    if (!spaceName) throw new Error("No space name provided");

    const oauth2Client = getGoogleOAuthClient();
    const meet = google.meet({ version: "v2", auth: oauth2Client });

    const confRecordsRes = await meet.conferenceRecords.list({
      filter: `space.name="${spaceName}"`,
    });

    const records = confRecordsRes.data.conferenceRecords || [];
    if (!records.length) {
      return {
        success: false,
        message:
          "No conference record found yet. The meeting might still be ongoing.",
      };
    }

    const latestRecord = records[0];
    const conferenceRecordId = latestRecord.name;

    const participantsRes = await meet.conferenceRecords.participants.list({
      parent: conferenceRecordId,
    });

    const attendanceData = [];

    for (const participant of participantsRes.data.participants || []) {
      const sessionsRes =
        await meet.conferenceRecords.participants.participantSessions.list({
          parent: participant.name,
        });

      const sessions = sessionsRes.data.participantSessions || [];
      if (sessions.length > 0) {
        const checkInTime = new Date(sessions[0].startTime);
        const checkOutTime = new Date(sessions[sessions.length - 1].endTime);

        let totalElapsedMs = 0;
        sessions.forEach((s) => {
          if (s.startTime && s.endTime) {
            totalElapsedMs +=
              new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
          }
        });

        const durationMinutes = Math.round(totalElapsedMs / 60000);

        attendanceData.push({
          email: participant.signedinUser?.user || null,
          displayName:
            participant.signedinUser?.displayName ||
            participant.anonymousUser?.displayName ||
            "Participant",
          checkInTime,
          checkOutTime,
          durationMinutes,
          durationFormatted: formatDuration(durationMinutes),
        });
      }
    }

    return { success: true, attendanceData };
  } catch (error) {
    console.error("Failed to sync Google Meet Attendance:", error.message);
    throw new Error("Could not fetch attendance from Google Meet API.");
  }
}

function getTeacherGoogleAuthUrl(teacherId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",
    // Unified callback distinguishes teacher vs admin via state
    state: `teacher:${teacherId}`,
  });
}

function getAdminGoogleAuthUrl() {
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",
    state: "admin",
  });
}

module.exports = {
  GOOGLE_SCOPES,
  getGoogleOAuthClient,
  getAuthClientForTeacher,
  createCalendarMeetEvent,
  createGoogleMeetSpace,
  createGoogleMeetSpaceForTeacher,
  createSessionGoogleMeet,
  getTeacherGoogleAuthUrl,
  getAdminGoogleAuthUrl,
  syncGoogleMeetAttendance,
  formatDuration,
};
