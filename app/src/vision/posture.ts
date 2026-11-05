/**
 * Posture checks computed from MediaPipe landmarks. Pure functions: no DOM, no MediaPipe.
 * All angles are measured in pixel space (normalised coords × frame size).
 */
import type { Check } from "@guitar-coach/core";
import type { CameraCalibration } from "@/lib/settings";

export interface Pt {
  x: number;
  y: number;
}
export interface HandObs {
  landmarks: Pt[];
  /** MediaPipe's label ("Left"/"Right"), which assumes a mirrored selfie image. */
  label?: string;
}
export interface FrameObs {
  width: number;
  height: number;
  pose?: Pt[];
  hands: HandObs[];
}

export type PostureCheck = Extract<Check, `posture.${string}`>;
export type PostureValues = Partial<Record<PostureCheck, number>>;

// MediaPipe pose indices
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;

export const THRESHOLDS: Record<PostureCheck, number> = {
  "posture.rightWrist": 35,
  "posture.leftWrist": 45,
  "posture.leftThumb": 0.04,
  "posture.shoulders": 8,
};

export const MESSAGES: Record<PostureCheck, (v: number) => { title: string; detail: string }> = {
  "posture.rightWrist": (v) => ({ title: "Endereza la muñeca derecha", detail: `Está doblada ${Math.round(v)}°. Alinéala con el antebrazo.` }),
  "posture.leftWrist": (v) => ({ title: "Relaja la muñeca izquierda", detail: `Está muy doblada (${Math.round(v)}°). Acerca un poco el codo al cuerpo.` }),
  "posture.leftThumb": () => ({ title: "Baja el pulgar izquierdo", detail: "Se asoma por encima del mástil. Déjalo detrás, a la altura del dedo medio." }),
  "posture.shoulders": (v) => ({ title: "Nivela los hombros", detail: `Uno está más alto (${Math.round(v)}°). Suéltalos y respira.` }),
};

export const SPOKEN: Record<PostureCheck, string> = {
  "posture.rightWrist": "Endereza la muñeca derecha",
  "posture.leftWrist": "Relaja la muñeca izquierda",
  "posture.leftThumb": "Baja el pulgar izquierdo",
  "posture.shoulders": "Relaja los hombros",
};

const px = (p: Pt, f: FrameObs): Pt => ({ x: p.x * f.width, y: p.y * f.height });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function angleBetween(a: Pt, b: Pt): number {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (!la || !lb) return 0;
  const c = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Which detected hand is the player's right/left. Uses the pose wrists when available. */
export function assignHands(f: FrameObs): { right?: HandObs; left?: HandObs } {
  const hands = f.hands.filter((h) => h.landmarks.length >= 21);
  if (!hands.length) return {};
  const pose = f.pose;
  if (pose && pose[R_WRIST] && pose[L_WRIST]) {
    const rw = px(pose[R_WRIST], f);
    const lw = px(pose[L_WRIST], f);
    const d = (h: HandObs, w: Pt) => dist(px(h.landmarks[0]!, f), w);
    if (hands.length === 1) {
      const h = hands[0]!;
      return d(h, rw) <= d(h, lw) ? { right: h } : { left: h };
    }
    const [a, b] = hands as [HandObs, HandObs];
    return d(a, rw) + d(b, lw) <= d(a, lw) + d(b, rw) ? { right: a, left: b } : { right: b, left: a };
  }
  // Without pose: MediaPipe labels assume a mirrored image; our frames are not mirrored.
  const out: { right?: HandObs; left?: HandObs } = {};
  for (const h of hands) {
    if (h.label === "Left") out.right ??= h;
    else if (h.label === "Right") out.left ??= h;
  }
  return out;
}

function wristBend(elbow: Pt | undefined, hand: HandObs | undefined, f: FrameObs): number | undefined {
  if (!elbow || !hand) return undefined;
  const wrist = px(hand.landmarks[0]!, f);
  const mcp = px(hand.landmarks[9]!, f);
  const forearm = sub(wrist, px(elbow, f));
  const palm = sub(mcp, wrist);
  if (Math.hypot(forearm.x, forearm.y) < 0.04 * f.width) return undefined; // elbow too close: unreliable
  return angleBetween(forearm, palm);
}

/** Distance by which the left thumb tip sticks out over the neck, relative to the neck length. */
export function thumbOverNeck(hand: HandObs | undefined, calib: CameraCalibration | null | undefined, f: FrameObs): number | undefined {
  if (!hand || !calib) return undefined;
  const N = px({ x: calib.nut[0], y: calib.nut[1] }, f);
  const F = px({ x: calib.fret12[0], y: calib.fret12[1] }, f);
  const L = dist(N, F);
  if (L < 20) return undefined;
  const u = { x: (F.x - N.x) / L, y: (F.y - N.y) / L };
  const n = { x: -u.y, y: u.x };
  const along = (p: Pt) => (p.x - N.x) * u.x + (p.y - N.y) * u.y;
  const across = (p: Pt) => (p.x - N.x) * n.x + (p.y - N.y) * n.y;
  const T = px(hand.landmarks[4]!, f);
  const W = px(hand.landmarks[0]!, f);
  const a = along(T);
  if (a < -0.25 * L || a > 1.2 * L) return undefined; // the hand is not on the neck
  const halfWidth = 0.085 * L;
  const dT = across(T);
  const dW = across(W);
  if (Math.sign(dT) === Math.sign(dW) || Math.abs(dT) <= halfWidth) return 0;
  return (Math.abs(dT) - halfWidth) / L;
}

export function computePosture(f: FrameObs, calib?: CameraCalibration | null): { values: PostureValues; right?: HandObs; left?: HandObs } {
  const { right, left } = assignHands(f);
  const values: PostureValues = {};
  const pose = f.pose;
  const rw = wristBend(pose?.[R_ELBOW], right, f);
  if (rw !== undefined) values["posture.rightWrist"] = rw;
  const lw = wristBend(pose?.[L_ELBOW], left, f);
  if (lw !== undefined) values["posture.leftWrist"] = lw;
  if (pose?.[L_SHOULDER] && pose[R_SHOULDER]) {
    const a = px(pose[L_SHOULDER], f);
    const b = px(pose[R_SHOULDER], f);
    const tilt = Math.abs((Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI);
    values["posture.shoulders"] = Math.min(tilt, Math.abs(180 - tilt));
  }
  const th = thumbOverNeck(left, calib, f);
  if (th !== undefined) values["posture.leftThumb"] = th;
  return { values, right, left };
}

/**
 * Smooths noisy per-frame values and decides when a check is "in warning"
 * (beyond its threshold for a sustained time). Also tracks time-in-warning ratios.
 */
export class PostureTracker {
  private ema: PostureValues = {};
  private since: Partial<Record<PostureCheck, number>> = {};
  readonly warning = new Set<PostureCheck>();
  private frames: Partial<Record<PostureCheck, number>> = {};
  private warnFrames: Partial<Record<PostureCheck, number>> = {};

  constructor(
    private checks: PostureCheck[],
    private holdSec = 1.2,
  ) {}

  /** Returns checks that just entered the warning state. */
  update(values: PostureValues, t: number): { check: PostureCheck; value: number }[] {
    const entered: { check: PostureCheck; value: number }[] = [];
    for (const c of this.checks) {
      const v = values[c];
      if (v === undefined) continue;
      const prev = this.ema[c];
      const e = prev === undefined ? v : prev * 0.7 + v * 0.3;
      this.ema[c] = e;
      this.frames[c] = (this.frames[c] ?? 0) + 1;
      const over = e > THRESHOLDS[c];
      const under = e < THRESHOLDS[c] * 0.85; // hysteresis
      if (over) {
        this.since[c] ??= t;
        if (!this.warning.has(c) && t - this.since[c]! >= this.holdSec) {
          this.warning.add(c);
          entered.push({ check: c, value: e });
        }
      } else if (under) {
        delete this.since[c];
        this.warning.delete(c);
      }
      if (this.warning.has(c)) this.warnFrames[c] = (this.warnFrames[c] ?? 0) + 1;
    }
    return entered;
  }

  value(c: PostureCheck) {
    return this.ema[c];
  }

  ratios(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.checks) {
      const n = this.frames[c] ?? 0;
      if (n >= 10) out[c] = Math.round(((this.warnFrames[c] ?? 0) / n) * 1000) / 1000;
    }
    return out;
  }
}
