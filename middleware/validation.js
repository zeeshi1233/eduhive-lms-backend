const { body, validationResult } = require("express-validator")

// Validation middleware for common fields
exports.validateLoginInput = [
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 6 }),
]

exports.validateRegisterInput = [
  body("role").isIn(["teacher", "student"]),
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 6 }),
  body("name").notEmpty().trim(),
  body("phone").if(body("role").equals("teacher")).notEmpty().trim().isLength({ min: 7, max: 15 }).withMessage("Phone must be between 7 and 15 characters"),
  body("gender").if(body("role").equals("teacher")).optional().isIn(["male", "female", "other"]),
  body("qualification").if(body("role").equals("teacher")).notEmpty().trim(),
  body("specialization").if(body("role").equals("teacher")).notEmpty().trim(),
  body("experienceYears").if(body("role").equals("teacher")).optional().isInt({ min: 0 }).toInt(),
  body("assignedCourses")
    .if(body("role").equals("teacher"))
    .optional()
    .custom((value) => {
      if (typeof value === "string" && !value.trim()) return true
      if (Array.isArray(value)) return true
      return true
    }),
  body("boards")
    .if(body("role").equals("teacher"))
    .optional()
    .custom((value) => {
      if (typeof value === "string" && !value.trim()) return true
      if (Array.isArray(value)) return true
      return true
    }),
  body("level").if(body("role").equals("teacher")).optional().isIn(["O Level", "A Level"]),
  body("oLevelHourPay").if(body("role").equals("teacher")).optional().isFloat({ min: 0 }).toFloat(),
  body("availability").if(body("role").equals("teacher")).optional().trim(),
  body("joiningDate").if(body("role").equals("teacher")).optional().isISO8601().toDate(),
]

exports.validateTeacherUpdateInput = [
  body("name").optional().trim().notEmpty(),
  body("email").optional().isEmail().normalizeEmail(),
  body("password").optional().isLength({ min: 6 }),
  body("phone").optional().trim().isLength({ min: 7, max: 15 }),
  body("gender").optional().isIn(["male", "female", "other"]),
  body("qualification").optional().trim().notEmpty(),
  body("specialization").optional().trim().notEmpty(),
  body("experienceYears").optional().isInt({ min: 0 }).toInt(),
  body("assignedCourses")
    .optional()
    .custom((value) => {
      if (typeof value === "string" && !value.trim()) return true
      if (Array.isArray(value)) return true
      return true
    }),
  body("boards")
    .optional()
    .custom((value) => {
      if (typeof value === "string" && !value.trim()) return true
      if (Array.isArray(value)) return true
      return true
    }),
  body("level").optional().isIn(["O Level", "A Level"]),
  body("oLevelHourPay").optional().isFloat({ min: 0 }).toFloat(),
  body("availability").optional().trim(),
  body("joiningDate").optional().isISO8601().toDate(),
]

exports.validateCourseInput = [
  body("serialNumber").notEmpty().trim(),
  body("title").notEmpty().trim(),
  body("description").notEmpty().trim(),
  body("feePKR").optional().isFloat({ min: 0 }).toFloat(),
  body("feeUSD").optional().isFloat({ min: 0 }).toFloat(),
  body("perHourFee").optional().isFloat({ min: 0 }).toFloat(),
  body("board").optional().trim(),
  body("otherBoard").optional().trim(),
]

exports.validateAssignmentInput = [
  body("title").notEmpty().trim(),
  body("description").notEmpty().trim(),
  body("dueDate").isISO8601(),
]

// Handle validation errors
exports.handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}
