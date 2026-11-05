import Dexie, { type Table } from "dexie";
import type { Curriculum, Profile, Session, SessionListItem } from "@guitar-coach/core";

export type CurriculumPayload = Curriculum & { isExample?: boolean };

export interface LocalSession {
  id: string;
  startedAt: string;
  /** 0 = waiting to upload, 1 = on the server */
  synced: 0 | 1;
  /** Full record when created on this device; list item when pulled from the server. */
  data: Session | SessionListItem;
  full: 0 | 1;
}

export interface LocalFile {
  sessionId: string;
  name: string;
  blob: Blob;
  uploaded: 0 | 1;
  uploadedAt?: string;
}

export interface KV {
  key: string;
  value: unknown;
}

class GuitarCoachDB extends Dexie {
  sessions!: Table<LocalSession, string>;
  files!: Table<LocalFile, [string, string]>;
  kv!: Table<KV, string>;
  constructor() {
    super("guitar-coach");
    this.version(1).stores({
      sessions: "id, startedAt, synced",
      files: "[sessionId+name], sessionId, uploaded",
      kv: "key",
    });
  }
}

export const db = new GuitarCoachDB();

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function setKV(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

export async function saveLocalSession(session: Session, files: { name: string; blob: Blob }[]) {
  await db.transaction("rw", db.sessions, db.files, async () => {
    await db.sessions.put({ id: session.id, startedAt: session.startedAt, synced: 0, data: session, full: 1 });
    for (const f of files) await db.files.put({ sessionId: session.id, name: f.name, blob: f.blob, uploaded: 0 });
  });
}

export async function updateLocalSession(id: string, patch: Partial<Session>) {
  const s = await db.sessions.get(id);
  if (!s) return;
  await db.sessions.put({ ...s, data: { ...s.data, ...patch } as Session, synced: s.full ? 0 : s.synced });
}

export async function getProfile(): Promise<Profile | undefined> {
  return getKV<Profile>("profile");
}

export async function saveProfile(patch: Partial<Profile>) {
  const current = (await getProfile()) ?? { formatVersion: 1 as const, updatedAt: new Date(0).toISOString(), currentLessonId: null };
  const next: Profile = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await setKV("profile", next);
  await setKV("profileDirty", true);
  return next;
}
