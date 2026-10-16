export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const apiPath = path.startsWith("/api") ? path : `/api${path}`;
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "https://reachout-dzwy.onrender.com").replace(/\/+$/, "");
  const response = await fetch(`${apiBaseUrl}${apiPath}`, {
    ...options, headers, credentials: "include"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method, body: body === undefined ? undefined : JSON.stringify(body)
});
