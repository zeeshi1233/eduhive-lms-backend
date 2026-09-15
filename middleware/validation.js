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
  body("gender")
    .if(body("role").equals("teacher"))
    .optional({ values: "falsy" })
    .customSanitizer((v) => String(v || "").toLowerCase())
    .isIn(["male", "female", "other"]),
  body("qualification").if(body("role").equals("teacher")).notEmpty().trim(),
  // specialization UI field removed — backend defaults from qualification in teacherPayload
  body("experienceYears")
    .if(body("role").equals("teacher"))
    .optional({ values: "falsy" })
    .isInt({ min: 0 })
    .toInt(),
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
  body("level").if(body("role").equals("teacher")).optional({ values: "falsy" }).isIn(["O Level", "A Level"]),
  body("oLevelHourPay")
    .if(body("role").equals("teacher"))
    .optional({ values: "falsy" })
    .isFloat({ min: 0 })
    .toFloat(),
  body("availability").if(body("role").equals("teacher")).optional({ values: "falsy" }).trim(),
  body("joiningDate")
    .if(body("role").equals("teacher"))
    .optional({ values: "falsy" })
    .isISO8601()
    .toDate(),
  // Student fields — keep soft so FormData registration does not fail validation
  body("gender")
    .if(body("role").equals("student"))
    .optional({ values: "falsy" })
    .customSanitizer((v) => String(v || "").toLowerCase())
    .isIn(["male", "female", "other"]),
  body("address").if(body("role").equals("student")).optional({ values: "falsy" }).trim(),
  body("dateOfBirth")
    .if(body("role").equals("student"))
    .optional({ values: "falsy" })
    .isISO8601()
    .toDate(),
  body("admissionDate")
    .if(body("role").equals("student"))
    .optional({ values: "falsy" })
    .isISO8601()
    .toDate(),
]

exports.validateTeacherUpdateInput = [
  body("name").optional().trim().notEmpty(),
  body("email").optional().isEmail().normalizeEmail(),
  body("password").optional().isLength({ min: 6 }),
  body("phone").optional().trim().isLength({ min: 7, max: 15 }),
  body("gender")
    .optional({ values: "falsy" })
    .customSanitizer((v) => String(v || "").toLowerCase())
    .isIn(["male", "female", "other"]),
  body("qualification").optional().trim().notEmpty(),
  // specialization UI field removed — ignored if clients still send it
  body("experienceYears").optional({ values: "falsy" }).isInt({ min: 0 }).toInt(),
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
  body("level").optional({ values: "falsy" }).isIn(["O Level", "A Level"]),
  body("oLevelHourPay").optional({ values: "falsy" }).isFloat({ min: 0 }).toFloat(),
  body("availability").optional({ values: "falsy" }).trim(),
  body("joiningDate").optional({ values: "falsy" }).isISO8601().toDate(),
]

exports.validateCourseInput = [
  body("title").notEmpty().trim(),
  body("description").notEmpty().trim(),
  body("serialNumber").optional().trim(),
  body("code").optional().trim(),
  body("courseCode").optional().trim(),
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
    const list = errors.array()
    return res.status(400).json({
      message: list[0]?.msg || "Validation failed",
      errors: list,
    })
  }
  next()
}
