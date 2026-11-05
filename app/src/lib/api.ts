/** Thin client for the guitar-coach server (same origin). */
async function req(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeout ?? 10000);
  try {
    return await fetch(path, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function getJSON<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<{ status: number; data: T | null; etag: string | null }> {
  const res = await req(path, init);
  if (res.status === 304) return { status: 304, data: null, etag: res.headers.get("etag") };
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return { status: res.status, data: (await res.json()) as T, etag: res.headers.get("etag") };
}

export async function putJSON(path: string, body: unknown) {
  const res = await req(path, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeout: 20000 });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

export async function putBlob(path: string, blob: Blob) {
  const res = await req(path, { method: "PUT", body: blob, headers: { "content-type": blob.type || "application/octet-stream" }, timeout: 10 * 60 * 1000 });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
