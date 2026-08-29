const errorHandler = (err, req, res, next) => {
  console.error("Server Error:", err)

  // Ensure CORS headers are attached even on unhandled server errors
  const origin = req.headers?.origin
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*")
  }
  res.setHeader("Access-Control-Allow-Credentials", "true")

  const status = err.status || err.statusCode || 500
  const message = err.message || "Internal Server Error"

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { error: err.message }),
  })
}

module.exports = errorHandler
