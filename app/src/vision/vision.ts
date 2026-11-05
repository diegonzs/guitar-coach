/**
 * MediaPipe Tasks (hands + pose) running locally in the browser. Video never leaves
 * the device for analysis. Assets are served by our own server (/mediapipe, /models)
 * and cached by the service worker for offline use; Google's CDN is the fallback.
 */
import type { HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { FrameObs, HandObs, Pt } from "./posture";

const LOCAL_WASM = "/mediapipe/wasm";
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`;
export const MODEL_URLS = {
  hand: ["/models/hand_landmarker.task", "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"],
  pose: ["/models/pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"],
};

async function firstAvailable(urls: string[]): Promise<string> {
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "HEAD" });
      if (r.ok) return u;
    } catch {
      /* try next */
    }
  }
  return urls[urls.length - 1]!;
}

let loading: Promise<{ hands: HandLandmarker; pose: PoseLandmarker }> | null = null;

export function loadVision() {
  if (!loading)
    loading = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const wasm = (await firstAvailable([`${LOCAL_WASM}/vision_wasm_internal.js`])).startsWith("/") ? LOCAL_WASM : CDN_WASM;
      const fileset = await vision.FilesetResolver.forVisionTasks(wasm);
      const [handModel, poseModel] = await Promise.all([firstAvailable(MODEL_URLS.hand), firstAvailable(MODEL_URLS.pose)]);
      const make = async <T>(fn: (delegate: "GPU" | "CPU") => Promise<T>) => {
        try {
          return await fn("GPU");
        } catch {
          return await fn("CPU");
        }
      };
      const hands = await make((delegate) =>
        vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: handModel, delegate }, runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: 0.4, minTrackingConfidence: 0.4 }),
      );
      const pose = await make((delegate) =>
        vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: poseModel, delegate }, runningMode: "VIDEO", numPoses: 1 }),
      );
      return { hands, pose };
    })().catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Fetches every vision asset once so the service worker caches them for offline use. */
export async function prefetchVisionAssets(): Promise<number> {
  const urls = [
    `${LOCAL_WASM}/vision_wasm_internal.js`,
    `${LOCAL_WASM}/vision_wasm_internal.wasm`,
    `${LOCAL_WASM}/vision_wasm_module_internal.js`,
    `${LOCAL_WASM}/vision_wasm_module_internal.wasm`,
    MODEL_URLS.hand[0]!,
    MODEL_URLS.pose[0]!,
  ];
  let ok = 0;
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) {
        await r.arrayBuffer();
        ok++;
      }
    } catch {
      /* offline */
    }
  }
  return ok;
}

/** Runs detection on a video element at a limited frame rate. */
export class VisionLoop {
  private stopped = false;
  private lastPose: Pt[] | undefined;
  private lastTs = 0;
  private lastMediaTs = 0;
  private frameNo = 0;
  fps = 0;
  private fpsCount = 0;
  private fpsAt = performance.now();

  constructor(
    private getVideo: () => HTMLVideoElement | null,
    private onFrame: (obs: FrameObs, tMs: number) => void,
    private maxFps = 15,
  ) {}

  async start() {
    const { hands, pose } = await loadVision();
    const step = () => {
      if (this.stopped) return;
      const now = performance.now();
      const video = this.getVideo();
      if (video && video.readyState >= 2 && now - this.lastTs >= 1000 / this.maxFps && video.videoWidth) {
        this.lastTs = now;
        const ts = Math.max(this.lastMediaTs + 1, Math.round(now));
        this.lastMediaTs = ts + 1;
        try {
          // pose every other frame; it changes slowly and halves the cost
          if (this.frameNo++ % 2 === 0 || !this.lastPose) {
            const p = pose.detectForVideo(video, ts);
            this.lastPose = p.landmarks[0]?.map((l) => ({ x: l.x, y: l.y }));
          }
          const h = hands.detectForVideo(video, ts + 1);
          const handObs: HandObs[] = h.landmarks.map((lm, i) => ({ landmarks: lm.map((l) => ({ x: l.x, y: l.y })), label: h.handedness[i]?.[0]?.categoryName }));
          this.onFrame({ width: video.videoWidth, height: video.videoHeight, pose: this.lastPose, hands: handObs }, now);
          this.fpsCount++;
          if (now - this.fpsAt > 1000) {
            this.fps = this.fpsCount;
            this.fpsCount = 0;
            this.fpsAt = now;
          }
        } catch (e) {
          console.warn("vision", e);
        }
      }
      requestAnimationFrame(step);
    };
    step();
  }

  stop() {
    this.stopped = true;
  }
}

const POSE_LINKS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
];
const HAND_LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export interface OverlayStyle {
  right: string;
  left: string;
  pose: string;
  neck?: { nut: [number, number]; fret12: [number, number] } | null;
}

/** Draws landmarks on a canvas sized like the video (unmirrored coordinates). */
export function drawOverlay(ctx: CanvasRenderingContext2D, obs: FrameObs, hands: { right?: HandObs; left?: HandObs }, style: OverlayStyle) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const s = w / 640;
  const line = (a: Pt, b: Pt, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  };
  const dot = (p: Pt, color: string, r: number) => {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  ctx.lineCap = "round";
  if (style.neck) {
    ctx.setLineDash([6 * s, 6 * s]);
    line({ x: style.neck.nut[0], y: style.neck.nut[1] }, { x: style.neck.fret12[0], y: style.neck.fret12[1] }, "rgba(255,255,255,.45)", 2);
    ctx.setLineDash([]);
  }
  if (obs.pose) {
    for (const [a, b] of POSE_LINKS) if (obs.pose[a] && obs.pose[b]) line(obs.pose[a]!, obs.pose[b]!, style.pose, 3);
    for (const i of [11, 12, 13, 14, 15, 16]) if (obs.pose[i]) dot(obs.pose[i]!, style.pose, 3.5);
  }
  for (const [hand, color] of [
    [hands.right, style.right],
    [hands.left, style.left],
  ] as const) {
    if (!hand) continue;
    for (const [a, b] of HAND_LINKS) line(hand.landmarks[a]!, hand.landmarks[b]!, color, 2);
    hand.landmarks.forEach((p, i) => dot(p, color, i === 0 ? 4 : 2.5));
  }
}

/** JPEG snapshot of the video with the overlay on top (for the instructor to review). */
export async function snapshot(video: HTMLVideoElement, overlay: HTMLCanvasElement | null, maxW = 960): Promise<Blob | null> {
  if (!video.videoWidth) return null;
  const k = Math.min(1, maxW / video.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * k);
  c.height = Math.round(video.videoHeight * k);
  const g = c.getContext("2d")!;
  g.drawImage(video, 0, 0, c.width, c.height);
  if (overlay) g.drawImage(overlay, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
}
