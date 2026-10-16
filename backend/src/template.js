import { z } from "zod";

export const templateInput = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().max(60).default("General"),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(30000)
});

export function renderTemplate(text, values) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}
export function unresolvedPlaceholders(text) {
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]))];
}
