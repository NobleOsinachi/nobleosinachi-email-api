require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;

// ----- SECURITY & CORS -----
app.use(helmet());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*", // e.g. "https://nobleosinachi.github.io"
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// If you're behind a proxy (Render, etc.)
app.set("trust proxy", 1);

// ----- RATE LIMITING -----
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

// ----- BODY PARSING -----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----- RESEND SETUP -----
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "Noble Osinachi <onboarding@resend.dev>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "nobleosinachi98@gmail.com";

// ----- TEMPLATE HELPER -----
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
    // simple fallback
    return `<p>Hi ${
      replacements.name || "there"
    }, thank you for your message!</p>`;
  }
}

// ----- HEALTH CHECK -----
app.get("/", (req, res) => {
  res.send("OK");
});

// ----- SHARED FORM HANDLER (HOMEPAGE + VIDEO EDITOR) -----
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

    // ----- Notification email (to you) -----
    const notificationHtml = renderTemplate(
      "email_notification_template.html",
      replacements
    );

    const notifyResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `New Contact Form Submission: ${project}`,
      html: notificationHtml,
      reply_to: email,
    });

    if (notifyResult.error) {
      console.error("Error sending notification email:", notifyResult.error);
      throw new Error(notifyResult.error.message);
    }

    // ----- Confirmation email (to user) -----
    const confirmationHtml = renderTemplate(
      "email_template.html",
      replacements
    );

    const confirmResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Thank you for your inquiry",
      html: confirmationHtml,
    });

    if (confirmResult.error) {
      console.error("Error sending confirmation email:", confirmResult.error);
      throw new Error(confirmResult.error.message);
    }

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

// ----- ROUTES -----

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

// ----- START SERVER -----
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
