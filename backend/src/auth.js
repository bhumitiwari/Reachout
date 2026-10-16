import crypto from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128)
});
const COOKIE = "session";

function cookieOptions() {
  return {
    httpOnly: true, secure: config.SESSION_COOKIE_SECURE === "true",
    sameSite: "lax", path: "/", maxAge: 1000 * 60 * 60 * 24 * 7
  };
}
function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 7 * 86400000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
export function readSession(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sub || data.exp < Date.now()) return null;
    return data.sub;
  } catch { return null; }
}
export function requireAuth(req, res, next) {
  const userId = readSession(req.cookies?.[COOKIE]);
  if (!userId) return res.status(401).json({ error: "Please log in." });
  prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } })
    .then((user) => {
      if (!user) return res.status(401).json({ error: "Session expired. Please log in again." });
      req.user = user;
      next();
    }).catch(next);
}
export async function register(req, res) {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a name, valid email, and password of at least 12 characters." });
  try {
    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash },
      select: { id: true, name: true, email: true }
    });
    res.cookie(COOKIE, signSession(user.id), cookieOptions());
    return res.status(201).json({ user });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "An account with this email already exists." });
    throw e;
  }
}
export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.cookie(COOKIE, signSession(user.id), cookieOptions());
  return res.json({ user: { id: user.id, name: user.name, email: user.email } });
}
export function logout(req, res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.SESSION_COOKIE_SECURE === "true", sameSite: "lax", path: "/" });
  res.json({ ok: true });
}
export async function me(req, res) {
  const userId = readSession(req.cookies?.[COOKIE]);
  if (!userId) return res.status(401).json({ error: "Not logged in." });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
  if (!user) return res.status(401).json({ error: "Not logged in." });
  res.json({ user });
}
