/**
 * Offline-first sync. Data flows one way per kind, so there are no conflicts:
 *   sessions + media:   device → server   (immutable, idempotent PUT by id)
 *   curriculum:         server → device   (etag)
 *   session list:       server → device   (merged by id)
 *   profile:            both ways, last write wins by updatedAt
 */
import { useSyncExternalStore } from "react";
import type { Profile, SessionListItem } from "@guitar-coach/core";
import { db, getKV, setKV, type CurriculumPayload } from "./db";
import { getJSON, putBlob, putJSON } from "./api";
import { getSettings } from "./settings";

export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastSync: string | null;
  pending: number;
  error: string | null;
  /** True when the server is serving the example curriculum. */
  exampleCurriculum: boolean;
}

let state: SyncState = { online: navigator.onLine, syncing: false, lastSync: null, pending: 0, error: null, exampleCurriculum: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useSync(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

async function countPending() {
  const n = await db.sessions.where("synced").equals(0).count();
  set({ pending: n });
  return n;
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  set({ syncing: true, error: null });
  try {
    try {
      await getJSON("/api/health", { timeout: 4000 });
      set({ online: true });
    } catch {
      set({ online: false, syncing: false });
      await countPending();
      return;
    }

    // 1) push pending sessions and their media
    const pending = await db.sessions.where("synced").equals(0).toArray();
    for (const s of pending) {
      await putJSON(`/api/sessions/${encodeURIComponent(s.id)}`, s.data);
      const files = await db.files.where("sessionId").equals(s.id).toArray();
      for (const f of files) {
        if (f.uploaded) continue;
        await putBlob(`/api/sessions/${encodeURIComponent(s.id)}/files/${encodeURIComponent(f.name)}`, f.blob);
        await db.files.update([f.sessionId, f.name], { uploaded: 1, uploadedAt: new Date().toISOString() });
      }
      await db.sessions.update(s.id, { synced: 1 });
    }

    // 2) profile (last write wins)
    const local = await getKV<Profile>("profile");
    if (local && (await getKV<boolean>("profileDirty"))) {
      const stored = (await putJSON("/api/profile", local)) as Profile;
      await setKV("profile", stored);
      await setKV("profileDirty", false);
    } else {
      const remote = (await getJSON<Profile | null>("/api/profile")).data;
      if (remote && (!local || remote.updatedAt > local.updatedAt)) await setKV("profile", remote);
    }

    // 3) curriculum
    const etag = await getKV<string>("curriculumEtag");
    const cur = await getJSON<CurriculumPayload>("/api/curriculum", { headers: etag ? { "if-none-match": etag } : {} });
    if (cur.status === 200 && cur.data) {
      await setKV("curriculum", cur.data);
      await setKV("curriculumEtag", cur.etag);
    }
    const c = cur.data ?? (await getKV<CurriculumPayload>("curriculum"));
    set({ exampleCurriculum: !!c?.isExample });

    // 4) sessions from other devices
    const list = (await getJSON<SessionListItem[]>("/api/sessions")).data ?? [];
    const ids = new Set(await db.sessions.toCollection().primaryKeys());
    const fresh = list.filter((s) => !ids.has(s.id));
    if (fresh.length) await db.sessions.bulkPut(fresh.map((s) => ({ id: s.id, startedAt: s.startedAt, synced: 1 as const, data: s, full: 0 as const })));

    // 5) free space: drop uploaded media older than N days
    const cutoff = new Date(Date.now() - getSettings().keepMediaDays * 86400000).toISOString();
    const old = await db.files.where("uploaded").equals(1).filter((f) => !!f.uploadedAt && f.uploadedAt < cutoff).primaryKeys();
    if (old.length) await db.files.bulkDelete(old);

    set({ lastSync: new Date().toISOString() });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ syncing: false });
    await countPending();
  }
}

export function startSyncLoop() {
  void countPending();
  void syncNow();
  const tick = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  setInterval(tick, 60_000);
  addEventListener("online", tick);
  addEventListener("offline", () => set({ online: false }));
  document.addEventListener("visibilitychange", tick);
}

/** Remove media already on the server from this device. */
export async function freeUploadedMedia() {
  const keys = await db.files.where("uploaded").equals(1).primaryKeys();
  await db.files.bulkDelete(keys);
  return keys.length;
}
