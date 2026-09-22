const { google } = require('googleapis');

// Helper to initialize OAuth2 client
function getGoogleOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
  }
  return oauth2Client;
}

// Format minutes into a readable string (e.g., "1 hr 15 mins")
function formatDuration(minutes) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return "0 mins";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) {
    return `${h} hr${h > 1 ? 's' : ''} ${m} min${m !== 1 ? 's' : ''}`;
  }
  return `${m} min${m !== 1 ? 's' : ''}`;
}

// Create a Google Meet Space
async function createGoogleMeetSpace() {
  try {
    const oauth2Client = getGoogleOAuthClient();
    const meet = google.meet({ version: 'v2', auth: oauth2Client });
    
    // accessType: RESTRICTED is only available for Google Workspace (paid) accounts.
    // For standard @gmail.com accounts, we must omit the config to use the default settings.
    const response = await meet.spaces.create({
      requestBody: {
        config: {
          accessType: "OPEN",
        },
      },
    });

    return {
      spaceName: response.data.name,        // e.g. "spaces/ABC123XYZ"
      meetingUri: response.data.meetingUri   // e.g. "https://meet.google.com/abc-defg-hij"
    };
  } catch (error) {
    console.error("Failed to create Google Meet Space:", error.message);
    throw new Error("Could not generate Google Meet link. Please ensure Google Workspace is connected.");
  }
}

// Fetch exact attendance logs from Google Meet API
async function syncGoogleMeetAttendance(spaceName) {
  try {
    if (!spaceName) throw new Error("No space name provided");
    
    const oauth2Client = getGoogleOAuthClient();
    const meet = google.meet({ version: 'v2', auth: oauth2Client });
    
    // 1. Fetch conference records for the space
    const confRecordsRes = await meet.conferenceRecords.list({
      filter: `space.name="${spaceName}"`
    });

    const records = confRecordsRes.data.conferenceRecords || [];
    if (!records.length) {
      return { success: false, message: "No conference record found yet. The meeting might still be ongoing." };
    }

    // 2. We use the most recent conference record
    const latestRecord = records[0]; 
    const conferenceRecordId = latestRecord.name; 

    // 3. Fetch participants
    const participantsRes = await meet.conferenceRecords.participants.list({
      parent: conferenceRecordId
    });

    const attendanceData = [];
    
    for (const participant of participantsRes.data.participants || []) {
      // 4. Fetch sessions (check in / out) for each participant
      const sessionsRes = await meet.conferenceRecords.participants.participantSessions.list({
        parent: participant.name
      });

      const sessions = sessionsRes.data.participantSessions || [];
      if (sessions.length > 0) {
        const checkInTime = new Date(sessions[0].startTime);
        const checkOutTime = new Date(sessions[sessions.length - 1].endTime);
        
        let totalElapsedMs = 0;
        sessions.forEach(s => {
          totalElapsedMs += new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
        });
        
        const durationMinutes = Math.round(totalElapsedMs / 60000);
        
        attendanceData.push({
          email: participant.signedinUser?.user || null,
          displayName: participant.signedinUser?.displayName || participant.anonymousUser?.displayName || "Participant",
          checkInTime,
          checkOutTime,
          durationMinutes,
          durationFormatted: formatDuration(durationMinutes)
        });
      }
    }
    
    return { success: true, attendanceData };
    
  } catch (error) {
    console.error("Failed to sync Google Meet Attendance:", error.message);
    throw new Error("Could not fetch attendance from Google Meet API.");
  }
}


// Create a Google Meet Space using the teacher's own OAuth token (teacher = host)
// Falls back to admin token if teacher hasn't connected their Google account
async function createGoogleMeetSpaceForTeacher(teacher) {
  const refreshToken = teacher?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN;
  
  if (!refreshToken) {
    throw new Error("No Google refresh token available. Please connect your Google account or contact admin.");
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const meet = google.meet({ version: 'v2', auth: oauth2Client });
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
    console.error("Failed to create Google Meet Space for teacher:", error.message);
    // Fallback to admin token
    if (teacher?.googleRefreshToken && process.env.GOOGLE_REFRESH_TOKEN) {
      console.log("Falling back to admin token for Meet creation...");
      return createGoogleMeetSpace();
    }
    throw new Error("Could not generate Google Meet link. Please ensure Google account is connected.");
  }
}

// Generate OAuth URL for teacher Google connect
function getTeacherGoogleAuthUrl(teacherId) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
    state: teacherId,
  });
}

module.exports = {
  getGoogleOAuthClient,
  createGoogleMeetSpace,
  createGoogleMeetSpaceForTeacher,
  getTeacherGoogleAuthUrl,
  syncGoogleMeetAttendance,
  formatDuration
};
