function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatDate(value) {
  if (!value) return "N/A"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "N/A"
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatGender(value) {
  if (!value) return "N/A"
  const g = String(value)
  return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase()
}

function courseLabels(student) {
  const list = student.enrolledCourses || []
  return list
    .map((c) => {
      if (!c) return ""
      if (typeof c === "string") return c
      return (
        c.course?.title ||
        c.title ||
        c.courseTitle ||
        c.name ||
        ""
      )
    })
    .filter(Boolean)
}

/**
 * HTML email matching Student Profile Details modal layout / EduHive branding.
 * @param {object} student
 * @param {{ avatarCid?: string, avatarUrl?: string }} [options]
 */
function buildStudentProfileEmail(student = {}, options = {}) {
  const name = escapeHtml(student.name || "Student")
  const email = escapeHtml(student.email || "N/A")
  const phone = escapeHtml(student.phone || "N/A")
  const gender = escapeHtml(formatGender(student.gender))
  const dob = escapeHtml(formatDate(student.dateOfBirth))
  const address = escapeHtml(student.address || "N/A")
  const guardian = escapeHtml(student.guardianName || "N/A")
  const guardianPhone = escapeHtml(student.guardianPhone || "N/A")
  const admission = escapeHtml(formatDate(student.admissionDate))
  const courses = courseLabels(student)

  // Prefer inline CID (embedded) so clients show the photo without "Show pictures"
  let avatarSrc = ""
  if (options.avatarCid) {
    avatarSrc = `cid:${options.avatarCid}`
  } else if (options.avatarUrl) {
    avatarSrc = options.avatarUrl
  } else if (student.profileImage) {
    avatarSrc = String(student.profileImage).replace("/svg?", "/png?").replace(/\/svg$/i, "/png")
    if (avatarSrc.startsWith("//")) avatarSrc = `https:${avatarSrc}`
  } else {
    avatarSrc = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(
      student.name || "student"
    )}&size=256`
  }

  const courseChips = courses.length
    ? courses
        .map(
          (label) =>
            `<span style="display:inline-block;background:rgba(254,186,1,0.2);color:#854d0e;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;margin:0 6px 6px 0;">${escapeHtml(
              label
            )}</span>`
        )
        .join("")
    : `<span style="color:#94A3B8;font-size:13px;">No course enrolled</span>`

  const row = (label, value) => `
    <tr>
      <td style="padding:8px 0;color:#64748B;font-size:13px;width:140px;vertical-align:top;">${label}</td>
      <td style="padding:8px 0;color:#0F172A;font-size:14px;font-weight:600;">${value}</td>
    </tr>`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Student Profile Details</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">
          <tr>
            <td style="background:#F8FAFC;border-bottom:1px solid #E2E8F0;padding:18px 22px;">
              <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#FEBA01;font-weight:700;margin-bottom:4px;">EduHive LMS</div>
              <div style="font-size:20px;font-weight:700;color:#0F172A;">Student Profile Details</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="100" valign="top">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="border:2px solid #FEBA01;border-radius:50%;overflow:hidden;">
                      <tr>
                        <td style="width:90px;height:90px;line-height:0;font-size:0;">
                          <img src="${escapeHtml(avatarSrc)}" alt="Profile photo" width="90" height="90" style="width:90px;height:90px;border-radius:50%;object-fit:cover;display:block;border:0;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" style="padding-left:16px;">
                    <div style="font-size:22px;font-weight:700;color:#0F172A;margin-bottom:6px;">${name}</div>
                    <div style="font-size:13px;color:#64748B;">
                      Admission Date:
                      <strong style="color:#0F172A;">${admission}</strong>
                    </div>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0;" />

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:12px;">
                    <table role="presentation" width="100%">
                      ${row("Email", email)}
                      ${row("Phone", phone)}
                      ${row("Gender", gender)}
                      ${row("DOB", dob)}
                      ${row("Address", address)}
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:12px;">
                    <table role="presentation" width="100%">
                      ${row("Guardian", guardian)}
                      ${row("Guardian Phone", guardianPhone)}
                    </table>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0;" />

              <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:10px;">Courses Enrolled</div>
              <div>${courseChips}</div>
            </td>
          </tr>
          <tr>
            <td style="background:#0F172A;padding:14px 22px;text-align:center;">
              <span style="color:#FEBA01;font-weight:700;font-size:13px;">EduHive</span>
              <span style="color:#94A3B8;font-size:12px;"> — Build to Educate</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    "Student Profile Details — EduHive LMS",
    "",
    `Name: ${student.name || "N/A"}`,
    `Email: ${student.email || "N/A"}`,
    `Phone: ${student.phone || "N/A"}`,
    `Gender: ${formatGender(student.gender)}`,
    `DOB: ${formatDate(student.dateOfBirth)}`,
    `Address: ${student.address || "N/A"}`,
    `Guardian: ${student.guardianName || "N/A"}`,
    `Guardian Phone: ${student.guardianPhone || "N/A"}`,
    `Admission Date: ${formatDate(student.admissionDate)}`,
    `Courses: ${courses.length ? courses.join(", ") : "None"}`,
  ].join("\n")

  return {
    subject: `EduHive Student Profile — ${student.name || "Student"}`,
    html,
    text,
  }
}

module.exports = { buildStudentProfileEmail }
