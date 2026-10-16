import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import multer from "multer";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { register, login, logout, me, requireAuth } from "./auth.js";
import { encryptSecret, safeError } from "./security.js";
import { renderTemplate, unresolvedPlaceholders, templateInput } from "./template.js";
import { parseSmtpInput, validateSmtpHost, makeTransport, verifyTransport, sendWithAccount } from "./smtp.js";

const app = express();
app.set("trust proxy", config.isProduction ? 1 : false);
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(config.isProduction ? "combined" : "dev"));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
app.post("/api/auth/register", authLimiter, asyncRoute(register));
app.post("/api/auth/login", authLimiter, asyncRoute(login));
app.post("/api/auth/logout", logout);
app.get("/api/auth/me", asyncRoute(me));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", (req, res, next) => {
  if (["/auth/register", "/auth/login", "/auth/logout", "/auth/me", "/health"].includes(req.path)) return next();
  return requireAuth(req, res, next);
});

app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const [templates, contacts, accounts, sent, recent] = await Promise.all([
    prisma.template.count({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
    prisma.smtpAccount.count({ where: { userId } }),
    prisma.emailHistory.count({ where: { userId, status: "sent", sentAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
    prisma.emailHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 6,
      select: { id: true, recipientName: true, recipientEmail: true, organization: true, subject: true, status: true, createdAt: true } })
  ]);
  res.json({ stats: { templates, contacts, accounts, sentThisWeek: sent }, recent });
}));

// Templates
app.get("/api/templates", asyncRoute(async (req, res) => {
  res.json(await prisma.template.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: "desc" } }));
}));
app.post("/api/templates", asyncRoute(async (req, res) => {
  const parsed = templateInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid template fields." });
  const item = await prisma.template.create({ data: { ...parsed.data, userId: req.user.id } });
  res.status(201).json(item);
}));
app.put("/api/templates/:id", asyncRoute(async (req, res) => {
  const parsed = templateInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid template fields." });
  const result = await prisma.template.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: parsed.data });
  if (!result.count) return res.status(404).json({ error: "Template not found." });
  res.json(await prisma.template.findFirst({ where: { id: req.params.id, userId: req.user.id } }));
}));
app.delete("/api/templates/:id", asyncRoute(async (req, res) => {
  const result = await prisma.template.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  if (!result.count) return res.status(404).json({ error: "Template not found." });
  res.json({ ok: true });
}));

// Contacts
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  organization: z.string().trim().max(160).optional().nullable(),
  role: z.string().trim().max(120).optional().nullable(),
  notes: z.string().max(5000).optional().nullable()
});
app.get("/api/contacts", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  res.json(await prisma.contact.findMany({
    where: { userId: req.user.id, ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } },
      { organization: { contains: q, mode: "insensitive" } }
    ] } : {}) },
    orderBy: { updatedAt: "desc" }, take: 300
  }));
}));
app.post("/api/contacts", asyncRoute(async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a name and valid email." });
  res.status(201).json(await prisma.contact.create({ data: { ...parsed.data, userId: req.user.id } }));
}));
app.put("/api/contacts/:id", asyncRoute(async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a name and valid email." });
  const result = await prisma.contact.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: parsed.data });
  if (!result.count) return res.status(404).json({ error: "Contact not found." });
  res.json(await prisma.contact.findFirst({ where: { id: req.params.id, userId: req.user.id } }));
}));
app.delete("/api/contacts/:id", asyncRoute(async (req, res) => {
  const result = await prisma.contact.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  if (!result.count) return res.status(404).json({ error: "Contact not found." });
  res.json({ ok: true });
}));

// SMTP accounts
const publicAccount = ({ encryptedCredentials, ...safe }) => safe;
app.get("/api/smtp", asyncRoute(async (req, res) => {
  const accounts = await prisma.smtpAccount.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" } });
  res.json(accounts.map(publicAccount));
}));
app.post("/api/smtp", asyncRoute(async (req, res) => {
  const parsed = parseSmtpInput(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the SMTP fields and try again." });
  try { await validateSmtpHost(parsed.data.host); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const userId = req.user.id;
  const existingCount = await prisma.smtpAccount.count({ where: { userId } });
  if (existingCount >= 5) return res.status(400).json({ error: "You can save up to 5 SMTP accounts." });
  const { password, ...data } = parsed.data;
  if (data.isDefault) await prisma.smtpAccount.updateMany({ where: { userId }, data: { isDefault: false } });
  const account = await prisma.smtpAccount.create({
    data: { ...data, userId, encryptedCredentials: encryptSecret(password), isDefault: data.isDefault || existingCount === 0 }
  });
  res.status(201).json(publicAccount(account));
}));
app.delete("/api/smtp/:id", asyncRoute(async (req, res) => {
  const found = await prisma.smtpAccount.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!found) return res.status(404).json({ error: "SMTP account not found." });
  await prisma.smtpAccount.delete({ where: { id: found.id } });
  res.json({ ok: true });
}));
app.post("/api/smtp/:id/test", asyncRoute(async (req, res) => {
  const account = await prisma.smtpAccount.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!account) return res.status(404).json({ error: "SMTP account not found." });
  try { await verifyTransport(account); res.json({ ok: true, message: "SMTP connection verified." }); }
  catch (e) { res.status(400).json({ error: safeError(e) }); }
}));
app.post("/api/smtp/:id/test-email", asyncRoute(async (req, res) => {
  const parsed = z.object({ to: z.string().email().max(254) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid destination email." });
  const account = await prisma.smtpAccount.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!account) return res.status(404).json({ error: "SMTP account not found." });
  try {
    const transport = makeTransport(account, (await import("./security.js")).decryptSecret(account.encryptedCredentials));
    try {
      await transport.sendMail({ from: { name: account.senderName, address: account.senderEmail }, to: parsed.data.to,
        subject: "Outreach Mailer test email", text: "Your SMTP configuration is working." });
    } finally { transport.close(); }
    res.json({ ok: true, message: "Test email submitted to your SMTP server." });
  } catch (e) { res.status(400).json({ error: safeError(e) }); }
}));

// Preview and send
const composeSchema = z.object({
  smtpAccountId: z.string().min(1),
  contactId: z.string().optional().nullable(),
  recipientName: z.string().trim().max(120).optional().default(""),
  recipientEmail: z.string().trim().email().max(254),
  organization: z.string().trim().max(160).optional().default(""),
  role: z.string().trim().max(120).optional().default(""),
  position: z.string().trim().max(160).optional().default(""),
  personalNote: z.string().max(5000).optional().default(""),
  yourName: z.string().trim().max(120).optional().default(""),
  yourEmail: z.string().trim().email().max(254).optional().default(""),
  portfolioUrl: z.string().trim().max(500).optional().default(""),
  linkedinUrl: z.string().trim().max(500).optional().default(""),
  templateId: z.string().optional().nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(30000)
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_ATTACHMENT_MB * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["application/pdf", "text/plain", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    cb(allowed.has(file.mimetype) ? null : new Error("Only PDF, TXT, DOC, and DOCX attachments are allowed."), allowed.has(file.mimetype));
  }
});
function composeValues(data) {
  return {
    name: data.recipientName, email: data.recipientEmail, organization: data.organization,
    role: data.role, position: data.position, personal_note: data.personalNote,
    your_name: data.yourName, your_email: data.yourEmail,
    portfolio_url: data.portfolioUrl, linkedin_url: data.linkedinUrl
  };
}
function renderCompose(data) {
  const values = composeValues(data);
  return { subject: renderTemplate(data.subject, values), body: renderTemplate(data.body, values) };
}
app.post("/api/emails/preview", asyncRoute(async (req, res) => {
  const parsed = composeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check recipient, account, subject, and body fields." });
  const account = await prisma.smtpAccount.findFirst({ where: { id: parsed.data.smtpAccountId, userId: req.user.id } });
  if (!account) return res.status(400).json({ error: "Select one of your saved SMTP accounts." });
  const rendered = renderCompose(parsed.data);
  const missing = [...unresolvedPlaceholders(rendered.subject), ...unresolvedPlaceholders(rendered.body)];
  res.json({ ...rendered, unresolvedPlaceholders: [...new Set(missing)] });
}));
app.post("/api/emails/send", upload.array("attachments", 3), asyncRoute(async (req, res) => {
  let body;
  try { body = JSON.parse(req.body.payload || "{}"); } catch { return res.status(400).json({ error: "Invalid email payload." }); }
  const parsed = composeSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: "Check recipient, account, subject, and body fields." });
  const data = parsed.data;
  const rendered = renderCompose(data);
  const missing = [...new Set([...unresolvedPlaceholders(rendered.subject), ...unresolvedPlaceholders(rendered.body)])];
  if (missing.length) return res.status(400).json({ error: `Fill these template fields before sending: ${missing.join(", ")}` });
  rendered.subject = String(rendered.subject ?? "")
  .replace(/[\r\n]+/g, " ")
  .trim();

if (!rendered.subject) {
  return res.status(400).json({
    error: "Please enter an email subject."
  });
}
  const userId = req.user.id;
  const account = await prisma.smtpAccount.findFirst({ where: { id: data.smtpAccountId, userId } });
  if (!account) return res.status(400).json({ error: "Select one of your saved SMTP accounts." });

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.emailHistory.count({ where: { userId, status: "sent", sentAt: { gte: hourAgo } } });
  if (recentCount >= config.MAX_EMAILS_PER_HOUR) return res.status(429).json({ error: "Hourly sending limit reached. Try again later." });
  const duplicate = await prisma.emailHistory.findFirst({
    where: { userId, recipientEmail: data.recipientEmail, subject: rendered.subject, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, status: "sent" }
  });
  if (duplicate && req.body.confirmDuplicate !== "true") return res.status(409).json({ error: "A similar email was sent to this address in the last 24 hours. Confirm before resending." });

  const files = req.files || [];
  const attachments = files.map((f) => ({ filename: f.originalname.replace(/[\\r\\n]/g, "_").slice(0, 180), content: f.buffer, contentType: f.mimetype }));
  const record = await prisma.emailHistory.create({ data: {
    userId, smtpAccountId: account.id, recipientName: data.recipientName || null,
    recipientEmail: data.recipientEmail, organization: data.organization || null,
    subject: rendered.subject, body: rendered.body, status: "sending",
    attachmentName: files.map((f) => f.originalname).join(", ") || null
  }});
  try {
    const info = await sendWithAccount(account, {
      recipientName: data.recipientName, recipientEmail: data.recipientEmail,
      subject: rendered.subject, text: rendered.body,
      html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(rendered.body)}</div>`,
      attachments
    });
    await prisma.emailHistory.update({ where: { id: record.id }, data: {
      status: "sent", providerMessageId: info.messageId || null, sentAt: new Date(), errorMessage: null
    }});
    res.status(201).json({ ok: true, message: "SMTP server accepted the email.", id: record.id });
  } catch (e) {
    await prisma.emailHistory.update({ where: { id: record.id }, data: { status: "failed", errorMessage: safeError(e) } });
    res.status(502).json({ error: `Email could not be submitted: ${safeError(e)}`, id: record.id });
  }
}));
app.get("/api/emails/history", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const status = ["sent", "failed", "sending"].includes(String(req.query.status)) ? String(req.query.status) : undefined;
  res.json(await prisma.emailHistory.findMany({
    where: { userId: req.user.id, ...(status ? { status } : {}), ...(q ? { OR: [
      { recipientEmail: { contains: q, mode: "insensitive" } }, { recipientName: { contains: q, mode: "insensitive" } },
      { organization: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }
    ] } : {}) },
    orderBy: { createdAt: "desc" }, take: 300,
    select: { id: true, recipientName: true, recipientEmail: true, organization: true, subject: true, body: true, status: true, errorMessage: true, attachmentName: true, sentAt: true, createdAt: true, providerMessageId: true }
  }));
}));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `Attachment exceeds ${config.MAX_ATTACHMENT_MB} MB.` : "Attachment upload limit exceeded." });
  if (err?.message?.includes("attachments are allowed")) return res.status(400).json({ error: err.message });
  console.error("Request failed:", safeError(err));
  res.status(500).json({ error: "An unexpected server error occurred." });
});
app.use((_req, res) => res.status(404).json({ error: "Not found." }));

function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export default app;
