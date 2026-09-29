const Session = require('../models/Session');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const { calculateAccurateDuration, parseDurationMinutes } = require('../utils/classroom');

/**
 * POST /api/webhooks/google-meet
 * Receives Google Cloud Pub/Sub push notifications for Meet events.
 * Handles participant join/leave to auto-update attendance checkout times.
 */
exports.handleGoogleMeetWebhook = async (req, res) => {
  res.status(200).json({ received: true });

  try {
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

      const session = await Session.findOne({ googleMeetSpace: spaceName });
      if (!session) {
        console.warn(`[Webhook] No session found for space: ${spaceName}`);
        return;
      }

      const now = new Date(endTime);
      const scheduledMins = parseDurationMinutes(session.duration);

      const instructorEmailMatch = participantEmail &&
        session.teacherAttendance?.checkInTime &&
        !session.teacherAttendance?.checkOutTime;

      if (instructorEmailMatch) {
        session.set('teacherAttendance.checkOutTime', now);

        if (!Array.isArray(session.teacherAttendance.intervals)) {
          session.teacherAttendance.intervals = [];
          if (session.teacherAttendance.checkInTime) {
            session.teacherAttendance.intervals.push({
              checkInTime: session.teacherAttendance.checkInTime,
              checkOutTime: now,
            });
          }
        } else {
          const openInv = session.teacherAttendance.intervals.find((i) => !i.checkOutTime);
          if (openInv) openInv.checkOutTime = now;
        }

        const teacherDur = calculateAccurateDuration(
          session.teacherAttendance.intervals,
          session.startTime,
          session.endTime,
          scheduledMins
        );
        session.set('teacherAttendance.durationMinutes', teacherDur.durationMinutes);
        session.set('teacherAttendance.durationFormatted', teacherDur.durationFormatted);
        console.log(`[Webhook] Teacher checkout recorded for session ${session._id}: ${teacherDur.durationFormatted}`);
      }

      if (Array.isArray(session.studentAttendance)) {
        let updated = false;

        const updateStudentRec = async (record) => {
          record.leftAt = now;
          if (!Array.isArray(record.intervals)) {
            record.intervals = [];
            if (record.joinedAt) {
              record.intervals.push({ checkInTime: record.joinedAt, checkOutTime: now });
            }
          } else {
            const openInv = record.intervals.find((i) => !i.checkOutTime);
            if (openInv) openInv.checkOutTime = now;
          }

          const studentDur = calculateAccurateDuration(
            record.intervals,
            session.startTime,
            session.endTime,
            scheduledMins
          );
          record.durationMinutes = studentDur.durationMinutes;
          record.durationFormatted = studentDur.durationFormatted;

          try {
            await Attendance.findOneAndUpdate(
              { student: record.student, session: session._id },
              {
                intervals: record.intervals,
                durationMinutes: studentDur.durationMinutes,
                durationFormatted: studentDur.durationFormatted,
                markedAt: now,
              },
              { upsert: true }
            );
          } catch (e) {
            console.error('Error syncing Attendance in webhook:', e.message);
          }
        };

        if (participantEmail) {
          const student = await Student.findOne({
            $or: [
              { email: participantEmail },
              { googleEmail: participantEmail },
            ],
          }).select('_id');

          if (student) {
            const record = session.studentAttendance.find(
              (r) => String(r.student) === String(student._id) && r.present && !r.leftAt
            );
            if (record) {
              await updateStudentRec(record);
              updated = true;
              console.log(`[Webhook] Student ${student._id} checkout recorded at ${now.toISOString()}`);
            }
          }
        }

        if (!updated) {
          const record = session.studentAttendance.find((r) => r.present && !r.leftAt);
          if (record) {
            await updateStudentRec(record);
            console.log('[Webhook] Fallback student checkout recorded.');
          }
        }
      }

      await session.save();
      console.log(`[Webhook] Session ${session._id} attendance updated successfully.`);
      return;
    }

    if (
      eventType.includes('participant.v2.joined') ||
      eventType.includes('participantSession.started')
    ) {
      console.log('[Webhook] Participant joined notification logged.');
      return;
    }
  } catch (err) {
    console.error('[Webhook] Error processing Google Meet event:', err.message);
  }
};