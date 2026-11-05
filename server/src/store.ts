/** File-based storage for sessions and the student profile. No database on purpose:
 *  everything is plain JSON + media so an LLM (or a human) can read it directly. */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  FILE_NAME_RE,
  ProfileSchema,
  SESSION_ID_RE,
  SessionSchema,
  toListItem,
  type Profile,
  type Session,
  type SessionListItem,
} from "@guitar-coach/core";

export class StoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Store {
  private list: SessionListItem[] | null = null;

  constructor(readonly dataDir: string) {}

  get sessionsDir() {
    return join(this.dataDir, "sessions");
  }

  /** Resolves a path inside the data dir, refusing anything that escapes it. */
  private safe(...parts: string[]): string {
    const p = resolve(this.dataDir, ...parts);
    if (p !== this.dataDir && !p.startsWith(this.dataDir + sep)) throw new StoreError(400, "Ruta inválida");
    return p;
  }

  sessionDir(id: string): string {
    if (!SESSION_ID_RE.test(id)) throw new StoreError(400, "id de sesión inválido");
    return this.safe("sessions", id);
  }

  filePath(id: string, name: string): string {
    if (!FILE_NAME_RE.test(name) || name === "session.json") throw new StoreError(400, "Nombre de archivo inválido");
    return this.safe("sessions", id, name);
  }

  async init() {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  async listSessions(): Promise<SessionListItem[]> {
    if (this.list) return this.list;
    const out: SessionListItem[] = [];
    let dirs: string[] = [];
    try {
      dirs = await readdir(this.sessionsDir);
    } catch {
      /* empty */
    }
    for (const d of dirs) {
      if (!SESSION_ID_RE.test(d)) continue;
      const s = await this.getSession(d).catch(() => null);
      if (s) out.push(toListItem(s));
    }
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    this.list = out;
    return out;
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.sessionDir(id), "session.json"), "utf8"));
      const parsed = SessionSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      return null;
    }
  }

  async putSession(id: string, body: unknown): Promise<Session> {
    const dir = this.sessionDir(id);
    const parsed = SessionSchema.safeParse(body);
    if (!parsed.success) throw new StoreError(422, "Sesión inválida: " + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    if (parsed.data.id !== id) throw new StoreError(400, "El id no coincide con la URL");
    await mkdir(dir, { recursive: true });
    await atomicWrite(join(dir, "session.json"), JSON.stringify(parsed.data, null, 2));
    this.list = null;
    return parsed.data;
  }

  async putFile(id: string, name: string, body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<number> {
    const target = this.filePath(id, name);
    await mkdir(this.sessionDir(id), { recursive: true });
    if (!body) throw new StoreError(400, "Cuerpo vacío");
    const tmp = target + ".part";
    const writer = Bun.file(tmp).writer();
    let size = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new StoreError(413, "Archivo demasiado grande");
        writer.write(value);
      }
      await writer.end();
      await rename(tmp, target);
    } catch (e) {
      await reader.cancel().catch(() => {});
      await Promise.resolve(writer.end()).catch(() => {});
      await rm(tmp, { force: true });
      throw e;
    }
    return size;
  }

  async fileInfo(id: string, name: string) {
    const p = this.filePath(id, name);
    try {
      const s = await stat(p);
      return s.isFile() ? { path: p, size: s.size } : null;
    } catch {
      return null;
    }
  }

  async getProfile(): Promise<Profile | null> {
    try {
      const parsed = ProfileSchema.safeParse(JSON.parse(await readFile(this.safe("profile.json"), "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Last write wins, by `updatedAt`. Returns the profile that is now stored. */
  async putProfile(body: unknown): Promise<Profile> {
    const parsed = ProfileSchema.safeParse(body);
    if (!parsed.success) throw new StoreError(422, "Perfil inválido");
    const current = await this.getProfile();
    if (current && current.updatedAt > parsed.data.updatedAt) return current;
    await mkdir(this.dataDir, { recursive: true });
    await atomicWrite(this.safe("profile.json"), JSON.stringify(parsed.data, null, 2));
    return parsed.data;
  }

  async writeText(rel: string, content: string) {
    const p = this.safe(rel);
    await mkdir(resolve(p, ".."), { recursive: true });
    await atomicWrite(p, content);
    return p;
  }
}

async function atomicWrite(path: string, content: string) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
