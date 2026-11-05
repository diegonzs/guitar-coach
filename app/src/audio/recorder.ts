/** MediaRecorder wrapper that picks a format the current browser supports (Safari → mp4). */
const VIDEO_TYPES = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const AUDIO_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickType(video: boolean): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return (video ? VIDEO_TYPES : AUDIO_TYPES).find((t) => MediaRecorder.isTypeSupported(t));
}

export function extFor(type: string) {
  return type.includes("mp4") ? (type.startsWith("video") ? "mp4" : "m4a") : type.includes("ogg") ? "ogg" : "webm";
}

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  type = "";

  start(stream: MediaStream, video: boolean): boolean {
    const type = pickType(video);
    if (!type) return false;
    try {
      this.rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 96_000, videoBitsPerSecond: video ? 900_000 : undefined });
    } catch {
      return false;
    }
    this.type = type;
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    return true;
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: this.type.split(";")[0] }) : null);
      rec.stop();
    });
  }
}
