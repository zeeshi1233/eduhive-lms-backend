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

async function sendMail({ to, subject, html, text, attachments = [] }) {
  const transporter = getMailTransport()
  const fromName = process.env.EMAIL_FROM_NAME || "EduHive LMS"
  const from = process.env.EMAIL_USER

  const info = await transporter.sendMail({
    from: `"${fromName}" <${from}>`,
    to,
    subject,
    html,
    text,
    attachments,
  })

  return info
}

/**
 * Download profile image and return a nodemailer inline CID attachment.
 * Email clients often block remote images / do not render SVG — CID is reliable.
 */
async function buildAvatarAttachment(profileImage, name) {
  const cid = "student-avatar@eduhive"
  let url = String(profileImage || "").trim()

  if (!url) {
    url = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(
      name || "student"
    )}&size=256`
  } else {
    if (url.startsWith("//")) url = `https:${url}`
    // Prefer PNG over SVG for email clients
    url = url
      .replace("/svg?", "/png?")
      .replace(/\/svg$/i, "/png")
      .replace("format=svg", "format=png")
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: "image/*,*/*" },
    })
    if (!res.ok) {
      throw new Error(`Avatar fetch failed: ${res.status}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (!buffer.length) throw new Error("Empty avatar buffer")

    let contentType = res.headers.get("content-type") || "image/png"
    if (contentType.includes("svg")) {
      // Retry dicebear as PNG if we somehow got SVG
      const pngUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(
        name || "student"
      )}&size=256`
      const pngRes = await fetch(pngUrl)
      if (pngRes.ok) {
        const pngBuf = Buffer.from(await pngRes.arrayBuffer())
        return {
          filename: "avatar.png",
          content: pngBuf,
          cid,
          contentType: "image/png",
          contentDisposition: "inline",
        }
      }
    }

    const ext = contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
      ? "gif"
      : "png"

    return {
      filename: `avatar.${ext}`,
      content: buffer,
      cid,
      contentType: contentType.split(";")[0].trim() || "image/png",
      contentDisposition: "inline",
    }
  } catch (err) {
    console.error("Failed to embed student avatar for email:", err.message)
    // Last-resort tiny gold placeholder PNG (1x1 would look bad — use dicebear again as remote in HTML)
    return null
  }
}

module.exports = { getMailTransport, sendMail, buildAvatarAttachment }
