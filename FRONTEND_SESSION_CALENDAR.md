# EduHive LMS — Session & Class Calendar APIs

Frontend developer ke liye. Calendar, All Sessions, Create Session, teacher ongoing classes, aur student lecture schedule inhi APIs se live data len.

**Base URL:** `https://eduhive-lms-backend.vercel.app`

Local:

```
http://localhost:5000
```

---

## Auth (har request pe)

```
Authorization: Bearer <token>
Content-Type: application/json
```

Token login se aata hai:

| Role | Login API |
|---|---|
| Admin | `POST /api/admin/login` |
| Teacher | `POST /api/auth/teacher-login` |
| Student | `POST /api/auth/student-login` |

Admin calendar / courses / teachers / session create-update ke liye **admin token** use karo.

---

## Kaunsi screen kaunsi API

| Screen | Method | Endpoint | Token |
|---|---|---|---|
| Class Calendar list | `GET` | `/api/admin/sessions` | Admin |
| Calendar fallback | `GET` | `/api/sessions` | Logged-in user |
| Schedule class | `POST` | `/api/admin/sessions` | Admin |
| Create Session page | `POST` | `/api/admin/sessions` | Admin |
| All Sessions list | `GET` | `/api/admin/sessions` | Admin |
| Mark conducted / not conducted | `PUT` then `PATCH` | `/api/admin/sessions/:id` | Admin |
| Course dropdown | `GET` | `/api/admin/courses` | Admin |
| Instructor dropdown | `GET` | `/api/admin/teachers` | Admin |
| Course detail page | `GET` | `/api/admin/courses/:id` | Admin |
| Add / Edit course | `POST` / `PUT` | `/api/admin/courses` / `/api/admin/courses/:id` | Admin |
| Teacher ongoing classes | `GET` | `/api/teacher/sessions` | Teacher |
| Student lectures | `GET` | `/api/student/students-sessions` | Student |
| Join live class | `POST` | `/api/classroom/join` | Teacher / Student / Admin |
| Leave / end class | `POST` | `/api/classroom/leave` | Teacher / Student / Admin |
| Classroom info | `GET` | `/api/classroom/:sessionId` | Teacher / Student / Admin |

**Google Meet / Zoom `meetingLink` mat bhejo.** Class EduHive ke apne LiveKit classroom `/classroom/:sessionId` pe hoti hai.

Calendar pe **localStorage fallback mat rakho** agar ye APIs success return karein. Backend ab expected fields bhejta hai.

---

## Important rules (frontend)

1. **`endTime` mat bhejo** create pe. Backend `startTime + duration` se khud nikalta hai.
2. **`perClassFee` mat bhejo.**
3. Class type sirf ye 2:
   - `Regular Class`
   - `Extra Class`
4. Duration sirf ye 4:
   - `45 mins`
   - `60 mins`
   - `90 mins`
   - `120 mins`
5. Create pe default status backend set karta hai: **`Scheduled`**
6. Status update pe exactly ye values bhejo:
   - `conducted`
   - `not_conducted`
7. Calendar event id = response ka **`session._id`**
8. Dropdowns:
   - Course value = `course._id`
   - Teacher value = `teacher._id` (profile id, Auth id nahi)
9. List hamesha `response.sessions` array se padho. Empty case: `[]`, kabhi `undefined` nahi.
10. **`meetingLink` mat bhejo / mat mangwana.** Backend khud in-app classroom room banata hai.
11. Join button Google Meet pe nahi, platform route pe jaye: `/classroom/:sessionId`
12. Teacher **Join Class** = check-in (`status: ongoing`, `teacherAttendance.checkInTime`)
13. Teacher **End Class** = check-out (`status: conducted`, `teacherAttendance.checkOutTime`)
14. Student tab join kar sakta hai jab `canStudentJoin === true` / `isLive === true`

---

## Virtual Classroom (LiveKit — platform ke andar)

Class Google Meet pe nahi hoti. Instructor aur student **EduHive classroom** mein join karte hain.

```
/classroom/:sessionId
```

### Flow

1. Admin calendar se class schedule karta hai — koi meeting URL nahi.
2. Backend session ke sath room bana deta hai: `eduhive-class-<sessionId>`
3. Teacher **Join Class** → frontend `/classroom/:sessionId` kholta hai → `POST /api/classroom/join`
4. Join pe teacher **auto check-in** ho jata hai. Class live ho jati hai.
5. Student Join dabaye. Agar teacher ne start nahi kiya to `WAITING_FOR_TEACHER` aata hai. UI wait/retry kare.
6. Student successful join pe **present** mark ho jata hai.
7. Teacher **End Class** → `POST /api/classroom/leave` → check-out + `status: conducted`
8. Uske baad students join nahi kar sakte.

### Join class

```
POST /api/classroom/join
```

Alias (same body/response): `POST /api/get-room-token`

```json
{
  "sessionId": "66f1a1b2c3d4e5f678901234",
  "participantName": "Ali Khan"
}
```

`sessionId` required hai. `participantName` optional.

**Teacher success `200`:**

```json
{
  "token": "eyJhbGciOiJIUzI1...",
  "url": "wss://edu-hive-lms-l830o0rm.livekit.cloud",
  "livekitUrl": "wss://edu-hive-lms-l830o0rm.livekit.cloud",
  "roomName": "eduhive-class-66f1a1b2c3d4e5f678901234",
  "classroomPath": "/classroom/66f1a1b2c3d4e5f678901234",
  "participantName": "Ali Khan",
  "identity": "teacher-66bb22222222222222222222",
  "role": "teacher",
  "teacherCheckedIn": true,
  "teacherCheckInTime": "2026-09-15T10:02:11.000Z",
  "teacherCheckOutTime": null,
  "session": { "...formatted session..." }
}
```

Frontend LiveKit:

```js
<LiveKitRoom token={data.token} serverUrl={data.url} connect video audio>
  <VideoConference />
</LiveKitRoom>
```

**Student waiting (teacher ne start nahi kiya) `403`:**

```json
{
  "message": "Waiting for instructor to start the class",
  "code": "WAITING_FOR_TEACHER",
  "teacherCheckedIn": false,
  "teacherCheckedOut": false
}
```

Har 5 second retry karo jab tak token na mil jaye.

**Class ended `400` / `403`:**

```json
{
  "message": "This class has already ended",
  "code": "CLASS_ENDED"
}
```

### Leave / End class

```
POST /api/classroom/leave
```

```json
{
  "sessionId": "66f1a1b2c3d4e5f678901234"
}
```

| Role | Leave pe kya hota hai |
|---|---|
| Teacher | Check-out save, `status = conducted`, class band |
| Student | Sirf room leave, class continue |
| Admin | Room leave, class band nahi |

Teacher button label: **End Class**  
Student button label: **Leave Class**

**Teacher leave response `200`:**

```json
{
  "message": "Class ended. Instructor checked out.",
  "teacherCheckInTime": "2026-09-15T10:02:11.000Z",
  "teacherCheckOutTime": "2026-09-15T11:01:04.000Z",
  "session": {
    "status": "conducted",
    "isLive": false,
    "canStudentJoin": false,
    "teacherAttendance": {
      "checkInTime": "2026-09-15T10:02:11.000Z",
      "checkOutTime": "2026-09-15T11:01:04.000Z",
      "status": "checked-out"
    }
  }
}
```

### Classroom info

```
GET /api/classroom/:sessionId
```

```json
{
  "roomName": "eduhive-class-66f1...",
  "classroomPath": "/classroom/66f1...",
  "isLive": true,
  "canStudentJoin": true,
  "teacherAttendance": {
    "checkInTime": "2026-09-15T10:02:11.000Z",
    "checkOutTime": null,
    "status": "checked-in"
  },
  "session": { "...formatted session..." }
}
```

### Manual check-in / check-out (optional)

Same thing classroom join/leave automatically karti hai. Agar alag attendance button chahiye:

```
POST /api/teacher/teacher-attendance
```

```json
{ "sessionId": "66f1...", "action": "checkin" }
```

```json
{ "sessionId": "66f1...", "action": "checkout" }
```

---

## Session object (har list/create/update pe ye shape)

Backend `course` aur `instructor` populate karke bhejta hai. `teacher` = `instructor` ka alias.

```json
{
  "_id": "66f1a1b2c3d4e5f678901234",
  "title": "Physics Chapter 4",
  "topic": "Newton Laws",
  "courseId": "66aa11111111111111111111",
  "teacherId": "66bb22222222222222222222",
  "course": {
    "_id": "66aa11111111111111111111",
    "title": "Physics",
    "board": "Olevel GCE Cambridge",
    "code": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
    "serialNumber": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
    "description": "O Level Physics",
    "isActive": true
  },
  "instructor": {
    "_id": "66bb22222222222222222222",
    "name": "Ali Khan"
  },
  "teacher": {
    "_id": "66bb22222222222222222222",
    "name": "Ali Khan"
  },
  "startTime": "2026-09-15T10:00:00.000Z",
  "endTime": "2026-09-15T11:00:00.000Z",
  "duration": "60 mins",
  "type": "Regular Class",
  "status": "Scheduled",
  "roomName": "eduhive-class-66f1a1b2c3d4e5f678901234",
  "classroomPath": "/classroom/66f1a1b2c3d4e5f678901234",
  "joinUrl": "/classroom/66f1a1b2c3d4e5f678901234",
  "meetingLink": "/classroom/66f1a1b2c3d4e5f678901234",
  "isLive": false,
  "canStudentJoin": false,
  "teacherAttendance": {
    "checkInTime": null,
    "checkOutTime": null,
    "status": "not_started"
  },
  "description": "Agenda notes",
  "createdAt": "2026-09-14T08:00:00.000Z",
  "updatedAt": "2026-09-14T08:00:00.000Z"
}
```

UI mapping:

| UI field | API field |
|---|---|
| Event id | `_id` |
| Title | `title` |
| Course name | `course.title` |
| Course + board | `` `${course.title} for ${course.board}` `` |
| Course code | `course.code` ya `course.courseCode` |
| Instructor | `instructor.name` ya `teacher.name` |
| Start | `startTime` |
| End | `endTime` |
| Duration | `duration` |
| Type | `type` |
| Status | `status` |
| Join class | `classroomPath` (`/classroom/:id`) |
| Live? | `isLive` |
| Student join allowed? | `canStudentJoin` |
| Teacher check-in | `teacherAttendance.checkInTime` |
| Teacher check-out | `teacherAttendance.checkOutTime` |
| Notes | `description` |

---

## 1. Get sessions (Admin Calendar / All Sessions / Dashboard)

```
GET /api/admin/sessions
```

Optional filters:

```
GET /api/admin/sessions?courseId=66aa11111111111111111111
GET /api/admin/sessions?teacherId=66bb22222222222222222222
```

**Response `200`:**

```json
{
  "success": true,
  "count": 1,
  "sessions": [ { "...session object..." } ]
}
```

Agar admin call fail ho, fallback:

```
GET /api/sessions
```

Same response shape. Role ke hisaab se data filter hota hai (admin = all, teacher = apni, student = enrolled).

Sort: `startTime` ascending.

---

## 2. Create class (Class Calendar)

```
POST /api/admin/sessions
```

**Body:**

```json
{
  "title": "Physics Chapter 4",
  "courseId": "66aa11111111111111111111",
  "teacherId": "66bb22222222222222222222",
  "topic": "Physics Chapter 4",
  "startTime": "2026-09-15T10:00",
  "type": "Regular Class",
  "duration": "60 mins",
  "description": "Agenda / notes"
}
```

Required: `title`, `courseId`, `teacherId`, `startTime`  
Optional: `topic`, `type`, `duration`, `description`  
Do not send `meetingLink`. Backend `classroomPath` return karega.

`startTime` datetime-local se aise banao:

```js
const startTime = `${date}T${time}` // "2026-09-15T10:00"
```

**Response `201`:**

```json
{
  "message": "Session created",
  "session": {
    "_id": "66f1a1b2c3d4e5f678901234",
    "title": "Physics Chapter 4",
    "courseId": "66aa11111111111111111111",
    "teacherId": "66bb22222222222222222222",
    "startTime": "2026-09-15T10:00:00.000Z",
    "endTime": "2026-09-15T11:00:00.000Z",
    "type": "Regular Class",
    "status": "Scheduled",
    "duration": "60 mins",
    "meetingLink": "/classroom/66f1a1b2c3d4e5f678901234"
  }
}
```

Calendar pe local fake id mat use karo agar `_id` mil jaye:

```js
const saved = res.data.session
const eventId = saved._id
```

**Errors:**

| Code | Meaning |
|---|---|
| `400` | missing/invalid fields (`type`, `duration`, `startTime`, ids) |
| `404` | course ya teacher nahi mila |
| `401` / `403` | token missing / admin nahi |

---

## 3. Create session (legacy `/create-session` form)

Same API: `POST /api/admin/sessions`

```json
{
  "title": "Weekly Physics",
  "courseId": "66aa11111111111111111111",
  "teacherId": "66bb22222222222222222222",
  "topic": "Kinematics",
  "startTime": "2026-09-15T10:00",
  "type": "Regular Class"
}
```

`duration` na bhejo to backend `60 mins` + `endTime` auto set karega.

---

## 4. Update status (All Sessions)

Pehle PUT, fail pe PATCH. Dono kaam karte hain.

```
PUT  /api/admin/sessions/:id
PATCH /api/admin/sessions/:id
```

**Body:**

```json
{ "status": "conducted" }
```

```json
{ "status": "not_conducted" }
```

**Response `200`:**

```json
{
  "message": "Status updated",
  "session": {
    "_id": "66f1a1b2c3d4e5f678901234",
    "status": "conducted"
  }
}
```

`session` full object bhi aa sakta hai (course/instructor ke sath). UI ke liye `session.status` use karo.

Status labels:

| API value | UI label |
|---|---|
| `Scheduled` | Scheduled |
| `conducted` | Conducted |
| `completed` | Conducted (legacy alias) |
| `not_conducted` | Not Conducted |
| `Cancelled` | Cancelled |
| `ongoing` | Live / Ongoing |
| `pending` | Upcoming (legacy) |

---

## 5. Course dropdown + course pages

### List

```
GET /api/admin/courses
```

```json
{
  "courses": [
    {
      "_id": "66aa11111111111111111111",
      "title": "Physics",
      "board": "Olevel GCE Cambridge",
      "code": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
      "courseCode": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
      "serialNumber": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
      "description": "O Level Physics",
      "isActive": true
    }
  ]
}
```

Dropdown label:

```js
const label = course.board
  ? `${course.title} for ${course.board}`
  : course.title
const value = course._id
```

### Detail

```
GET /api/admin/courses/:id
```

`:id` Mongo `_id` ya course `code` dono chalenge.

```json
{
  "course": {
    "_id": "66aa11111111111111111111",
    "title": "Physics",
    "board": "Olevel GCE Cambridge",
    "code": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
    "courseCode": "PHYSICS-OLEVEL-GCE-CAMBRIDGE"
  }
}
```

### Create

```
POST /api/admin/courses
```

```json
{
  "title": "Physics",
  "description": "O Level Physics",
  "board": "Olevel GCE Cambridge",
  "code": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
  "serialNumber": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
  "courseCode": "PHYSICS-OLEVEL-GCE-CAMBRIDGE"
}
```

Required: `title`, `description`  
`code` na bhejo to backend title+board se generate karega.

Duplicate title+board ya duplicate code → **`409`**

```json
{ "message": "A course with this title and board already exists" }
```

### Update

```
PUT /api/admin/courses/:id
```

Same body as create.

**Response `200`:**

```json
{
  "message": "Course updated successfully",
  "course": { "...course..." }
}
```

---

## 6. Instructor dropdown

```
GET /api/admin/teachers
```

```json
{
  "teachers": [
    {
      "_id": "66bb22222222222222222222",
      "name": "Ali Khan",
      "email": "ali@school.com",
      "assignedCourses": ["66aa11111111111111111111"]
    }
  ]
}
```

```js
const value = teacher._id
const label = teacher.name
```

Session create pe yahi `_id` `teacherId` mein bhejo.

---

## 7. Teacher sessions

```
GET /api/teacher/sessions
GET /api/teacher/sessions?courseId=66aa11111111111111111111
```

Teacher token. Sirf us teacher ki classes.

```json
{
  "success": true,
  "count": 1,
  "sessions": [ { "...session object..." } ]
}
```

Ongoing / today filter frontend pe `startTime` se karo.

---

## 8. Student sessions

```
GET /api/student/students-sessions
```

Student token. Sirf enrolled courses ki classes. `endTime` hamesha present hota hai.

```json
{
  "success": true,
  "count": 1,
  "sessions": [
    {
      "course": { "_id": "66aa...", "title": "Physics" },
      "instructor": { "name": "Ali Khan" },
      "startTime": "2026-09-15T10:00:00.000Z",
      "endTime": "2026-09-15T11:00:00.000Z",
      "status": "Scheduled",
      "meetingLink": "/classroom/66f1a1b2c3d4e5f678901234"
    }
  ]
}
```

Time display:

```js
const time = `${new Date(s.startTime).toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit",
})} - ${new Date(s.endTime).toLocaleTimeString([], {
  hour: "2-digit",
  minute: "2-digit",
})}`
```

No enrollments:

```json
{ "success": true, "count": 0, "sessions": [] }
```

---

## Axios example

```js
import axiosInstance from "./axiosInstance"

// List
const { data } = await axiosInstance.get("/api/admin/sessions")
const sessions = data.sessions || []

// Create from calendar
const { data: created } = await axiosInstance.post("/api/admin/sessions", {
  title,
  courseId,
  teacherId,
  topic: title,
  startTime: `${date}T${time}`,
  type,       // "Regular Class" | "Extra Class"
  duration,   // "45 mins" | "60 mins" | "90 mins" | "120 mins"
  description,
})
const id = created.session._id

// Join EduHive classroom
navigate(`/classroom/${id}`)
const { data: room } = await axiosInstance.post("/api/classroom/join", { sessionId: id })

// Teacher ends class
await axiosInstance.post("/api/classroom/leave", { sessionId: id })

// Status
try {
  await axiosInstance.put(`/api/admin/sessions/${id}`, { status: "conducted" })
} catch {
  await axiosInstance.patch(`/api/admin/sessions/${id}`, { status: "conducted" })
}
```

---

## Common mistakes

| Galat | Sahi |
|---|---|
| `endTime` required samajhna | mat bhejo, backend calculate karega |
| `perClassFee` bhejna | mat bhejo |
| Google Meet / Zoom `meetingLink` bhejna | mat bhejo, Join `/classroom/:sessionId` pe jaye |
| Student ko teacher se pehle join karwana | wait until `canStudentJoin === true` |
| Teacher leave pe sirf navigate | pehle `POST /api/classroom/leave` call karo |
| `type: "Lecture"` | `Regular Class` ya `Extra Class` |
| `status: "Completed"` create pe | mat bhejo, default `Scheduled` hai |
| `teacherId` = Auth id | Teacher profile `_id` from `/api/admin/teachers` |
| `res.data.data` se list padhna | `res.data.sessions` |
| localStorage mein class save karna API success ke baad bhi | `session._id` use karke backend list dikhao |

---

## Quick copy-paste payloads

**Calendar create**

```json
{
  "title": "Physics Chapter 4",
  "courseId": "<course _id>",
  "teacherId": "<teacher _id>",
  "topic": "Physics Chapter 4",
  "startTime": "2026-09-15T10:00",
  "type": "Regular Class",
  "duration": "60 mins",
  "description": "Agenda / notes"
}
```

**Status update**

```json
{ "status": "conducted" }
```

**Course create**

```json
{
  "title": "Physics",
  "description": "O Level Physics",
  "board": "Olevel GCE Cambridge",
  "code": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
  "serialNumber": "PHYSICS-OLEVEL-GCE-CAMBRIDGE",
  "courseCode": "PHYSICS-OLEVEL-GCE-CAMBRIDGE"
}
```
