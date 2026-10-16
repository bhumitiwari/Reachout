import crypto from "node:crypto";
import { config } from "./config.js";

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload) {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential payload");
  const [iv, tag, encrypted] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function safeError(error) {
  const message = String(error?.message || "Unexpected error");
  return message
    .replace(/(pass(word)?|auth|token|secret)[=: ]+[^ ]+/ig, "$1=[redacted]")
    .slice(0, 400);
}
