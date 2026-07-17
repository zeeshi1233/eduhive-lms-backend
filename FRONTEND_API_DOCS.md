# 📘 EduHive LMS — Frontend API Documentation

> **Version:** 2.0 (Schema Restructure Update)
> **Base URL:** `https://your-backend-url.vercel.app/api`
> **Auth:** Bearer Token (JWT) — `Authorization: Bearer <token>`

---

## ⚠️ Breaking Changes Summary

| Old | New |
|-----|-----|
| `Student` model me `email`, `password` tha | Ab `Auth` model handle karta hai |
| `Teacher` model me `email`, `password` tha | Ab `Auth` model handle karta hai |
| JWT me sirf `id` (Student/Teacher ka) tha | Ab JWT me `id` (Auth ID) + `profileId` (Student/Teacher ID) dono hain |
| `Course` object me `students[]` array aata tha | Ab `students[]` array `StudentCourse` model se aata hai |
| `Course` object me `sessions[]` array aata tha | Sessions ab `course` field se directly query hoti hain |
| `Student` object me `enrolledCourses[]` aata tha | Ab `StudentCourse` model se aata hai — format badla hai |

---

## 🔐 AUTH APIs

### 1. Teacher Login
```
POST /api/auth/teacher-login
```

**Request Body:**
```json
{
  "email": "teacher@gmail.com",
  "password": "Password@123"
}
```

**Response (200):**
```json
{
  "message": "Teacher login successful",
  "token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "auth_doc_id",
    "profileId": "teacher_profile_id",
    "name": "Teacher Name",
    "email": "teacher@gmail.com",
    "role": "teacher",
    "profileImage": "https://..."
  }
}
```

> [!IMPORTANT]
> **Breaking Change:** Response me ab `profileId` bhi aata hai. `id` = Auth ka ID, `profileId` = Teacher profile ka ID. Frontend ko dono store karne chahiye.

---

### 2. Student Login
```
POST /api/auth/student-login
```

**Request Body:**
```json
{
  "email": "student@gmail.com",
  "password": "Password@123"
}
```

**Response (200):**
```json
{
  "message": "Student login successful",
  "token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "auth_doc_id",
    "profileId": "student_profile_id",
    "name": "Student Name",
    "email": "student@gmail.com",
    "role": "student",
    "profileImage": "https://..."
  }
}
```

---

### 3. Admin Login
```
POST /api/admin/login
```

**Request Body:**
```json
{
  "email": "admin@gmail.com",
  "password": "Admin@123"
}
```

**Response (200):**
```json
{
  "message": "Admin login successful",
  "token": "eyJhbGciOiJIUzI1...",
  "admin": {
    "id": "auth_doc_id",
    "profileId": "admin_profile_id",
    "name": "Admin",
    "email": "admin@gmail.com",
    "role": "admin"
  }
}
```

---

### 4. Get Current User
```
GET /api/auth/me
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "user": {
    "id": "auth_doc_id",
    "profileId": "profile_id",
    "email": "user@gmail.com",
    "role": "teacher | student | admin",
    "isActive": true,
    "name": "User Name",
    "phone": "...",
    "profileImage": "...",
    "assignedCourses": [...]
  }
}
```

---

### 5. Register Teacher / Student (Admin Only)
```
POST /api/auth/register
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

**Request Body (Teacher):**
```
role: "teacher"
email: "teacher@gmail.com"
password: "Password@123"
name: "Teacher Name"
phone: "03001234567"
qualification: "M.Sc Mathematics"
specialization: "Mathematics"
joiningDate: "2024-01-01"
experienceYears: 3
level: "O Level"
oLevelHourPay: 500
boards: ["Cambridge", "AKU"]
assignedCourses: ["courseId1", "courseId2"]
profileImage: <file>   (optional)
```

**Request Body (Student):**
```
role: "student"
email: "student@gmail.com"
password: "Password@123"
name: "Student Name"
phone: "03009876543"
dateOfBirth: "2005-06-15"
address: "Karachi"
guardianName: "Father Name"
guardianPhone: "03001111111"
feePlan: "monthly"
totalFees: 5000
admissionDate: "2024-01-15"
profileImage: <file>   (optional)
```

**Response (201):**
```json
{
  "message": "Teacher created successfully",
  "teacher": {
    "id": "teacher_profile_id",
    "name": "Teacher Name",
    "email": "teacher@gmail.com"
  }
}
```

---

## 👨‍💼 ADMIN APIs

> All admin routes require: `Authorization: Bearer <admin_token>`

---

### Teachers

#### Get All Teachers
```
GET /api/admin/teachers
```

**Response:**
```json
{
  "teachers": [
    {
      "_id": "teacher_id",
      "name": "Teacher Name",
      "email": "teacher@gmail.com",
      "phone": "...",
      "qualification": "...",
      "specialization": "...",
      "assignedCourses": [...],
      "isActive": true
    }
  ]
}
```

> [!NOTE]
> `email` ab Teacher document me nahi hai — backend Auth se fetch karke attach karta hai.

#### Update Teacher
```
PUT /api/admin/teachers/:id
Content-Type: multipart/form-data
```
All fields optional:
```
name, phone, email, qualification, specialization,
experienceYears, level, oLevelHourPay, boards,
assignedCourses, availability, joiningDate, profileImage
```

#### Delete Teacher
```
DELETE /api/admin/teachers/:id
```

---

### Students

#### Get All Students
```
GET /api/admin/students
```

**Response:**
```json
{
  "students": [
    {
      "_id": "student_id",
      "name": "Student Name",
      "email": "student@gmail.com",
      "phone": "...",
      "feePlan": "monthly",
      "totalFees": 5000,
      "feePaid": 2000,
      "isActive": true,
      "enrolledCourses": [
        {
          "course": { "_id": "...", "title": "Math" },
          "status": "active",
          "enrolledAt": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

> [!IMPORTANT]
> **Breaking Change:** `enrolledCourses` format badal gaya hai. Ab har item me `course` object + `status` + `enrolledAt` hoga. Frontend ko list render karte waqt `item.course.title` use karna hoga (pehle `item.title` tha).

#### Update Student
```
PUT /api/admin/students/:id
```

**Request Body:** (sab optional)
```json
{
  "name": "New Name",
  "email": "newemail@gmail.com",
  "phone": "...",
  "feePlan": "quarterly",
  "totalFees": 15000,
  "feePaid": 5000
}
```

#### Delete Student
```
DELETE /api/admin/students/:id
```

---

### Courses

#### Create Course
```
POST /api/admin/courses
Content-Type: multipart/form-data
```
```
serialNumber (required), title (required), description (required),
feePKR, feeUSD, perHourFee, board, otherBoard,
courseImage (file, optional)
```

#### Get All Courses
```
GET /api/admin/courses
```

**Response:**
```json
{
  "courses": [
    {
      "_id": "course_id",
      "title": "O Level Math",
      "description": "...",
      "feePKR": 5000,
      "feeUSD": 20,
      "instructor": { "_id": "...", "name": "Teacher Name" },
      "students": [
        { "_id": "student_id", "name": "Student Name" }
      ],
      "studentCount": 12,
      "isActive": true
    }
  ]
}
```

> [!IMPORTANT]
> **Breaking Change:** `students[]` ab `StudentCourse` model se populate hota hai. `studentCount` bhi available hai.

> [!WARNING]
> `sessions[]` array ab Course object me **bilkul nahi aata**. Sessions ke liye use karo: `GET /api/admin/sessions?courseId=...`

#### Update Course
```
PUT /api/admin/courses/:id
Content-Type: multipart/form-data
```

#### Delete Course
```
DELETE /api/admin/courses/:id
```

#### Assign Teacher to Course
```
POST /api/admin/courses/assign-teacher
```
```json
{
  "courseId": "course_id",
  "teacherId": "teacher_id"
}
```

---

### 🆕 Enrollments (BRAND NEW API)

#### Enroll Student in Course
```
POST /api/admin/enrollments
```
```json
{
  "studentId": "student_id",
  "courseId": "course_id",
  "status": "active"
}
```

**Response (201):**
```json
{
  "message": "Student enrolled successfully",
  "enrollment": {
    "_id": "enrollment_id",
    "courseId": "course_id",
    "studentId": "student_id",
    "status": "active",
    "enrolledAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Update Enrollment Status
```
PUT /api/admin/enrollments/:enrollmentId
```
```json
{
  "status": "completed"
}
```

> Status values: `"active"` | `"completed"` | `"dropped"`

---

### Sessions

#### Create Session
```
POST /api/admin/sessions
```
```json
{
  "title": "Session Title",
  "courseId": "course_id",
  "teacherId": "teacher_id",
  "startTime": "2024-07-20T18:00:00.000Z",
  "endTime": "2024-07-20T20:00:00.000Z",
  "topic": "Algebra Chapter 3",
  "meetingLink": "https://zoom.us/j/..."
}
```

> [!IMPORTANT]
> **Breaking Change:** Session create karne ke baad ab `Course.sessions[]` me push **nahi hota**. Sessions ab alag collection me hain.

#### Get All Sessions
```
GET /api/admin/sessions
GET /api/admin/sessions?teacherId=teacher_id
GET /api/admin/sessions?courseId=course_id
```

**Response:**
```json
{
  "success": true,
  "count": 5,
  "sessions": [
    {
      "_id": "session_id",
      "title": "Session Title",
      "course": { "_id": "...", "title": "Math" },
      "instructor": { "_id": "...", "name": "Teacher Name" },
      "startTime": "2024-07-20T18:00:00.000Z",
      "endTime": "2024-07-20T20:00:00.000Z",
      "topic": "...",
      "meetingLink": "https://...",
      "status": "pending | ongoing | conducted"
    }
  ]
}
```

#### Get Teacher Sessions (for Payroll)
```
GET /api/admin/teachers/:teacherId/sessions
```

#### Pay Teacher Salary by Session
```
POST /api/admin/teachers/pay-salary
```
```json
{
  "teacherId": "teacher_id",
  "sessionId": "session_id"
}
```

---

### Revenue & Payroll

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/revenue` | Revenue summary (total, pending, today) |
| GET | `/api/admin/revenue-details` | Revenue detail list |
| GET | `/api/admin/teacher-payrol/:teacherId` | Teacher payroll detail |
| GET | `/api/admin/transactions` | All transactions |
| GET | `/api/admin/payroll` | All payroll records |
| POST | `/api/admin/payroll/process` | Process teacher payment |

**Process Payment Body:**
```json
{
  "teacherId": "teacher_id",
  "amount": 5000,
  "description": "Monthly salary July"
}
```

---

## 👨‍🎓 STUDENT APIs

> All student routes require: `Authorization: Bearer <student_token>`

### Courses

#### Get Enrolled Courses
```
GET /api/student/courses
```

**Response:**
```json
{
  "courses": [
    {
      "_id": "course_id",
      "title": "Math",
      "instructor": { "_id": "...", "name": "Teacher" },
      "enrollmentId": "student_course_id",
      "status": "active",
      "enrolledAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

> [!IMPORTANT]
> **Breaking Change:** Response format badla. Ab har course me `enrollmentId`, `status`, `enrolledAt` extra fields hain.

#### Enroll in Course (Self)
```
POST /api/student/courses/enroll
```
```json
{
  "courseId": "course_id"
}
```

#### Get Course Details
```
GET /api/student/courses/:courseId
```

**Response:**
```json
{
  "course": {
    "_id": "...",
    "title": "...",
    "instructor": { "name": "..." },
    "assignments": [...],
    "sessions": [...]
  }
}
```

> [!NOTE]
> `sessions` ab Course document me embedded nahi hain — backend fetch karke attach karta hai. Response format same hi hai.

#### Get Completed Courses
```
GET /api/student/completed-courses
```

> [!NOTE]
> **Breaking Change:** Ab `StudentCourse.status === "completed"` se filter hota hai (pehle `Course.isActive === false` se hota tha).

---

### Assignments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/student/assignments` | My assignments |
| POST | `/api/student/assignments/submit` | Submit assignment (multipart) |

**Submit Assignment (multipart/form-data):**
```
assignmentId: "assignment_id"
submission: <file>
```

---

### Sessions

#### Get My Sessions
```
GET /api/student/students-sessions
```

**Response:**
```json
{
  "success": true,
  "count": 10,
  "sessions": [
    {
      "_id": "...",
      "title": "...",
      "course": { "_id": "...", "title": "Math" },
      "instructor": { "_id": "...", "name": "Teacher" },
      "startTime": "...",
      "endTime": "...",
      "status": "pending | ongoing | conducted",
      "meetingLink": "https://..."
    }
  ]
}
```

#### Mark Attendance
```
POST /api/student/student-attendance
```
```json
{
  "sessionId": "session_id",
  "attendanceData": [
    { "studentId": "student_id", "present": true }
  ]
}
```

---

### Other Student Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/student/attendance/:courseId` | Attendance report |
| POST | `/api/student/complaints` | Submit complaint (multipart) |
| GET | `/api/student/payments` | Payment history |
| GET | `/api/student/dashboard-stats` | Dashboard stats |
| GET | `/api/student/progress/:courseId` | Progress report |

**Dashboard Stats Response:**
```json
{
  "stats": {
    "totalCourses": 3,
    "completedCourses": 1,
    "attendance": {
      "present": 18,
      "total": 22,
      "percentage": "81.82"
    },
    "assignments": {
      "submitted": 5,
      "total": 8
    }
  }
}
```

---

## 👩‍🏫 TEACHER APIs

> All teacher routes require: `Authorization: Bearer <teacher_token>`

### Courses

#### Get Assigned Courses
```
GET /api/teacher/courses
```

**Response:**
```json
{
  "courses": [
    {
      "_id": "...",
      "title": "Math",
      "students": [
        { "_id": "...", "name": "Student Name" }
      ],
      "sessions": [...],
      "assignments": [...]
    }
  ]
}
```

> [!NOTE]
> `students`, `sessions`, `assignments` ab Course document me embedded nahi — backend alag queries se attach karta hai. Response format same hi hai.

---

### Assignments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teacher/assignments` | All assignments |
| GET | `/api/teacher/assignments/:courseId` | Course assignments |
| POST | `/api/teacher/assignments` | Create assignment (multipart) |
| PUT | `/api/teacher/assignments/:assignmentId` | Update assignment |
| DELETE | `/api/teacher/assignments/:assignmentId` | Delete assignment |
| PUT | `/api/teacher/assignments/grade` | Grade submission |

**Create Assignment (multipart/form-data):**
```
title (required), description (required), courseId (required),
dueDate, maxMarks, attachment (file, optional)
```

**Grade Submission:**
```json
{
  "assignmentId": "...",
  "submissionIndex": 0,
  "marksObtained": 85,
  "feedback": "Good work!"
}
```

---

### Sessions

#### Get My Sessions
```
GET /api/teacher/sessions
GET /api/teacher/sessions?courseId=course_id
```

#### Mark Teacher Attendance
```
POST /api/teacher/teacher-attendance
```
```json
{
  "sessionId": "session_id",
  "action": "checkin"
}
```
```json
{
  "sessionId": "session_id",
  "action": "checkout"
}
```

---

### Other Teacher Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teacher/dashboard-stats` | Dashboard stats |
| GET | `/api/teacher/get-students-progress` | Students progress |
| GET | `/api/teacher/session-transactions` | Session transactions |

**Dashboard Stats Response:**
```json
{
  "totalStudents": 25,
  "upcomingClasses": 4,
  "totalHoursTaught": 48.5
}
```

---

## 💾 Local Storage Guide

Login ke baad yeh values store karo:

```javascript
// Login response se save karo
localStorage.setItem("token", response.token)
localStorage.setItem("role", response.user.role)
localStorage.setItem("userId", response.user.id)            // Auth ID
localStorage.setItem("profileId", response.user.profileId)  // Teacher/Student Profile ID
localStorage.setItem("userName", response.user.name)
localStorage.setItem("userEmail", response.user.email)
```

---

## 🚦 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized (no token / invalid token) |
| 403 | Forbidden (wrong role) |
| 404 | Not Found |
| 500 | Server Error |

---

## ❌ Error Response Format

```json
{
  "message": "Error description here",
  "error": "Detailed error message"
}
```

---

*Last Updated: July 2025 — Backend Schema v2.0*
