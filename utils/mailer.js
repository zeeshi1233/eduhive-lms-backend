const nodemailer = require("nodemailer")

function getMailTransport() {
  const user = process.env.EMAIL_USER
  // Gmail app passwords may be pasted with spaces — strip them
  const pass = String(process.env.EMAIL_PASS || "").replace(/\s+/g, "")

  if (!user || !pass) {
    const error = new Error(
      "Email is not configured. Set EMAIL_USER and EMAIL_PASS in environment."
    )
    error.statusCode = 500
    error.code = "EMAIL_NOT_CONFIGURED"
    throw error
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  })
}

async function sendMail({ to, subject, html, text }) {
  const transporter = getMailTransport()
  const fromName = process.env.EMAIL_FROM_NAME || "EduHive LMS"
  const from = process.env.EMAIL_USER

  const info = await transporter.sendMail({
    from: `"${fromName}" <${from}>`,
    to,
    subject,
    html,
    text,
  })

  return info
}

module.exports = { getMailTransport, sendMail }
