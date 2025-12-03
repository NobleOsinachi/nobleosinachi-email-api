require("dotenv").config(); // Make sure you have a .env file

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*", // e.g. "https://yourdomain.com"
    methods: ["GET", "POST"],
  })
);

// If you're behind a proxy (e.g. Render, Vercel, Nginx)
app.set("trust proxy", 1);

// Simple rate limiting implementation
const ipRequestCounts = {};
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;

function simpleRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!ipRequestCounts[ip] || now - ipRequestCounts[ip].timestamp > WINDOW_MS) {
    ipRequestCounts[ip] = {
      count: 0,
      timestamp: now,
    };
  }

  ipRequestCounts[ip].count += 1;

  if (ipRequestCounts[ip].count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: "Too many requests, please try again later.",
    });
  }

  next();
}

// Parse JSON & form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Email transporter setup using environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER, // e.g. your Gmail address
    pass: process.env.SMTP_PASS, // e.g. your app password
  },
});

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.SMTP_USER; // where form notifications go

// Helper to render template with placeholders
function renderTemplateOriginal(fileName, replacements = {}) {
  const templatePath = path.join(__dirname, fileName);
  let content = fs.readFileSync(templatePath, "utf8");

  Object.entries(replacements).forEach(([key, value]) => {
    const regex = new RegExp(`\\$${key}`, "g");
    content = content.replace(regex, value);
  });

  return content;
}

function renderTemplate(fileName, replacements = {}) {
  try {
    const templatePath = path.join(__dirname, fileName);
    console.log("Reading template at:", templatePath);

    let content = fs.readFileSync(templatePath, "utf8");

    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`\\$${key}`, "g");
      content = content.replace(regex, value);
    });

    return content;
  } catch (err) {
    console.error(`Failed to read template ${fileName}:`, err);
    return `<p>Hi ${replacements.name}, thank you for your message!</p>`; // simple fallback
  }
}

// Health check
app.get("/", (req, res) => {
  res.send("OK");
});

// ---- SHARED FORM HANDLER ----
async function handleFormSubmission(req, res) {
  try {
    const { name, email, project, message } = req.body;

    if (!name || !email || !project || !message) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email address" });
    }

    const replacements = {
      name,
      email,
      project,
      message: message.replace(/\n/g, "<br>"),
    };

    // Notification email to you
    const notificationHtml = renderTemplate(
      "email_notification_template.html",
      replacements
    );

    await transporter.sendMail({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `New Contact Form Submission: ${project}`,
      html: notificationHtml,
      replyTo: email,
    });

    // Confirmation email to user
    const confirmationHtml = renderTemplate(
      "email_template.html",
      replacements
    );

    await transporter.sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: "Thank you for your inquiry",
      html: confirmationHtml,
    });

    return res.status(200).json({
      success: true,
      message: "Form submitted successfully! We will contact you soon.",
    });
  } catch (error) {
    console.error("Form submission error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }
}

// Homepage form
app.post("/homepage-form", simpleRateLimiter, handleFormSubmission);

// Video editor form – redirect (GET)
app.get("/video-editor-form", (req, res) => {
  res.redirect(
    process.env.VIDEO_EDITOR_URL ||
      "https://nobleosinachi.github.io/video-editor"
  );
});

// Video editor form – handle POST
app.post("/video-editor-form", simpleRateLimiter, handleFormSubmission);

// (Optional) Static files if you still need them
// app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
