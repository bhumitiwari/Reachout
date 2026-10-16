import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";
import nodemailer from "nodemailer";
import { z } from "zod";
import { decryptSecret } from "./security.js";

const smtpSchema = z.object({
  name: z.string().trim().min(1).max(80),
  senderName: z.string().trim().min(1).max(100),
  senderEmail: z.string().trim().email().max(254),
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  securityMode: z.enum(["STARTTLS", "TLS"]),
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(500),
  isDefault: z.boolean().optional().default(false)
});

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch { return false; }
}
export async function validateSmtpHost(host) {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local SMTP hosts are not allowed.");
  }
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("SMTP host must resolve to a public IP address.");
    return;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((r) => !isPublicAddress(r.address))) {
    throw new Error("SMTP host must resolve only to public IP addresses.");
  }
}
export function parseSmtpInput(body) {
  return smtpSchema.safeParse(body);
}
export function makeTransport(account, password) {
  const secure = account.securityMode === "TLS";
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure,
    auth: { user: account.username, pass: password },
    requireTLS: account.securityMode === "STARTTLS",
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }
  });
}
export async function verifyTransport(account) {
  await validateSmtpHost(account.host);
  const transport = makeTransport(account, decryptSecret(account.encryptedCredentials));
  try { await transport.verify(); } finally { transport.close(); }
}
export async function sendWithAccount(account, message) {
  await validateSmtpHost(account.host);
  const transport = makeTransport(account, decryptSecret(account.encryptedCredentials));
  try {
    return await transport.sendMail({
      from: { name: account.senderName, address: account.senderEmail },
      to: { name: message.recipientName || "", address: message.recipientEmail },
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments || []
    });
  } finally { transport.close(); }
}
