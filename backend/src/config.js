import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be 32 bytes encoded as 64 hex characters"),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().min(1).max(100).default(20),
  MAX_ATTACHMENT_MB: z.coerce.number().int().min(1).max(20).default(8)
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  encryptionKey: Buffer.from(parsed.data.CREDENTIAL_ENCRYPTION_KEY, "hex")
};
