# Learning Management System (LMS) Backend

A comprehensive Node.js + Express.js + MongoDB backend for an LMS supporting Admin, Teacher, and Student roles.

## Features

- **Authentication**: JWT-based role-based access control
- **User Management**: CRUD operations for admins, teachers, and students
- **Course Management**: Create, update, and manage courses
- **Assignments**: Create and grade assignments with file uploads
- **Sessions**: Manage class schedules and attendance tracking
- **Transactions**: Track payments and revenue
- **File Uploads**: Multer + Cloudinary integration for media storage
- **Dashboard**: Analytics for admins, teachers, and students

## Tech Stack

- Node.js
- Express.js
- MongoDB with Mongoose
- JWT Authentication
- Cloudinary (file uploads)
- Multer (middleware for file uploads)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your MongoDB URI and Cloudinary credentials

4. Start the server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user (protected)

### Admin Routes (Protected)
- `GET /api/admin/dashboard` - Dashboard statistics
- `POST /api/admin/teachers` - Create teacher
- `GET /api/admin/teachers` - Get all teachers
- `PUT /api/admin/teachers/:id` - Update teacher
- `DELETE /api/admin/teachers/:id` - Delete teacher
- `POST /api/admin/students` - Create student
- `GET /api/admin/students` - Get all students
- `POST /api/admin/courses` - Create course
- `GET /api/admin/courses` - Get all courses
- `PUT /api/admin/courses/:id` - Update course
- `DELETE /api/admin/courses/:id` - Delete course
- `POST /api/admin/courses/assign-teacher` - Assign teacher to course
- `GET /api/admin/transactions` - Get all transactions
- `GET /api/admin/payroll` - Get payroll records
- `POST /api/admin/payroll/process` - Process teacher payment

### Teacher Routes (Protected)
- `GET /api/teacher/courses` - Get assigned courses
- `POST /api/teacher/assignments` - Create assignment
- `GET /api/teacher/assignments/:courseId` - Get assignments for course
- `PUT /api/teacher/assignments/grade` - Grade assignment submission
- `POST /api/teacher/sessions` - Create session
- `POST /api/teacher/attendance/mark` - Mark attendance
- `GET /api/teacher/progress/:courseId` - Get student progress
- `GET /api/teacher/transactions` - Get teacher transactions

### Student Routes (Protected)
- `GET /api/student/courses` - Get enrolled courses
- `POST /api/student/courses/enroll` - Enroll in course
- `GET /api/student/courses/:courseId` - Get course details
- `POST /api/student/assignments/submit` - Submit assignment
- `GET /api/student/attendance/:courseId` - Get attendance report
- `POST /api/student/complaints` - Submit complaint
- `GET /api/student/payments` - Get payment history
- `GET /api/student/completed-courses` - Get completed courses
- `GET /api/student/progress/:courseId` - Get progress report

## Environment Variables

```
MONGODB_URI=mongodb://localhost:27017/lms
JWT_SECRET=your_secret_key_here
JWT_EXPIRE=7d
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
PORT=5000
NODE_ENV=development
ALLOWED_ORIGINS=https://eduhive-lms.vercel.app
```

## Project Structure

```
├── models/           # Mongoose schemas
├── controllers/      # Business logic
├── routes/          # API routes
├── middleware/      # Custom middleware
├── utils/           # Utility functions
├── server.js        # Main server file
└── README.md
```

## Error Handling

The API returns proper error responses:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## CORS

CORS is enabled for all origins. Update the CORS configuration in `index.js` for production.

## Notes

- All file uploads are stored on Cloudinary
- Passwords are hashed using bcryptjs
- JWT tokens expire based on `JWT_EXPIRE` environment variable
- Mongoose automatically handles database connections and validations

## Future Enhancements

- Email notifications
- Video streaming integration
- Live class support
- Mobile app authentication
- Advanced analytics
