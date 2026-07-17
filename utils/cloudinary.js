const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isDocument =
      file.mimetype === "application/pdf" ||
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return {
      folder: isDocument ? "lms-uploads/docs" : "lms-uploads/images",
      resource_type: isDocument ? "raw" : "image", // 🔥 MAGIC HERE
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
    };
  },
});


const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else
      cb(
        new Error(
          "Only JPG, PNG, GIF, PDF, and DOCX files are allowed"
        )
      );
  },
});

module.exports = { upload, cloudinary };
