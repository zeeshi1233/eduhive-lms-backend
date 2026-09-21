require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');
const readline = require('readline');

// Using your credentials directly from .env file
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/callback'; 

// Add the scopes you need for Google Meet / Calendar
const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/calendar.events'
];

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', 
  scope: SCOPES,
  prompt: 'consent'
});

console.log('Is link ko apne browser mein open karein aur login karke allow karein:\n');
console.log(authUrl, '\n');

rl.question('Browser se milne wala code yahan paste karein: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Tokens Successfully Retrieved!\n');
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('Access Token:', tokens.access_token);
    
    console.log('\nIs Refresh Token ko apne .env file mein "GOOGLE_REFRESH_TOKEN" ke aage save kar lein.');
  } catch (err) {
    console.error('Token retrieve karne mein error aaya:', err.message);
  }
});
