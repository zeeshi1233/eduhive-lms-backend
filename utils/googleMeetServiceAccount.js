const { google } = require('googleapis');

/**
 * Get a Google Auth client using Service Account + Domain-Wide Delegation.
 * The 'subject' field impersonates the teacher's Google email,
 * making them the automatic HOST of the created Meet space.
 */
function getServiceAccountAuth(teacherEmail) {
  const scopes = [
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly',
  ];

  let credentials;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // Vercel / production: store full JSON as env var
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    // Local dev: path to service account key file
    const fs = require('fs');
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
  } else {
    throw new Error('No Google Service Account credentials configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
    subject: teacherEmail, // 🔑 This is Domain-Wide Delegation — teacher becomes host
  });

  return auth;
}

/**
 * Create a Google Meet space where the teacher is the primary host.
 * Falls back to OAuth admin token if service account is not configured.
 * @param {string} teacherEmail - Teacher's Google Workspace email
 */
async function createMeetSpaceAsTeacher(teacherEmail) {
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN || '';

  // Validate teacher email belongs to Workspace domain
  if (domain && teacherEmail && !teacherEmail.endsWith('@' + domain)) {
    throw new Error(
      `Teacher email "${teacherEmail}" does not belong to the Workspace domain "@${domain}". \nPlease ensure the teacher has a Google Workspace account on this domain.`
    );
  }

  if (!teacherEmail) {
    throw new Error('Teacher Google email not found. Please set the teacher\'s Google Workspace email in their profile.');
  }

  const auth = getServiceAccountAuth(teacherEmail);
  const meet = google.meet({ version: 'v2', auth });

  const response = await meet.spaces.create({
    requestBody: {
      config: {
        accessType: "OPEN",
      },
    },
  });

  return {
    spaceName: response.data.name,       // e.g. "spaces/ABC123"
    meetingUri: response.data.meetingUri, // e.g. "https://meet.google.com/abc-defg-hij"
    hostedBy: teacherEmail,
  };
}

module.exports = { createMeetSpaceAsTeacher, getServiceAccountAuth };
