/**
 * Single AudioContext for the whole app: mic capture (AudioWorklet), metronome
 * output and reference tones all share one clock, which is what makes timing
 * measurements meaningful.
 */
export interface AudioBlock {
  /** Absolute frame index (AudioContext clock) of samples[0]. */
  frame: number;
  samples: Float32Array;
}

type BlockListener = (b: AudioBlock) => void;

class AudioEngine {
  ctx: AudioContext | null = null;
  mic: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private listeners = new Set<BlockListener>();
  private starting: Promise<void> | null = null;

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Must be called from a user gesture the first time (iOS). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      this.ctx.onstatechange = () => this.emitStatus();
      // iOS suspends ("interrupted") the context on calls, Siri, locking or switching apps
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void this.recover();
      });
      await this.ctx.audioWorklet.addModule("/audio/capture-worklet.js");
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    return this.ctx;
  }

  /** True while the mic delivers real audio (iOS can mute a "live" track, e.g. after a call or Siri). */
  private micAlive() {
    return !!this.mic && this.mic.getAudioTracks().some((t) => t.readyState === "live" && t.enabled && !t.muted);
  }

  /** Starts the microphone (idempotent; reopens it if the browser muted or ended it). */
  async startMic(): Promise<void> {
    if (this.micAlive()) {
      if (this.ctx && this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
      return;
    }
    if (this.starting) return this.starting;
    if (this.mic) this.stopMic();
    this.starting = (async () => {
      const ctx = await this.ensureContext();
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      for (const t of this.mic.getAudioTracks()) {
        t.onmute = t.onunmute = t.onended = () => this.emitStatus();
      }
      this.source = ctx.createMediaStreamSource(this.mic);
      this.capture = new AudioWorkletNode(ctx, "gc-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.capture.port.onmessage = (e: MessageEvent<AudioBlock>) => {
        this.lastBlockAt = performance.now();
        const x = e.data.samples;
        let r = 0;
        for (let i = 0; i < x.length; i++) r += x[i]! * x[i]!;
        r = Math.sqrt(r / x.length);
        // fast attack, slow release, like a VU meter
        this.level = r > this.level ? r : this.level * 0.85 + r * 0.15;
        for (const l of this.listeners) l(e.data);
      };
      // keep the worklet pulled by the graph without making any sound
      const mute = ctx.createGain();
      mute.gain.value = 0;
      this.source.connect(this.capture).connect(mute).connect(ctx.destination);
      this.lastBlockAt = performance.now();
      this.emitStatus();
    })().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Closes and reopens the mic. Call it from a tap: iOS only reopens capture on a user gesture. */
  async restartMic(): Promise<void> {
    this.stopMic();
    await this.ensureContext();
    await this.startMic();
  }

  stopMic() {
    this.mic?.getTracks().forEach((t) => {
      t.onmute = t.onunmute = t.onended = null;
      t.stop();
    });
    this.source?.disconnect();
    this.capture?.disconnect();
    this.mic = null;
    this.source = null;
    this.capture = null;
    this.level = 0;
    this.emitStatus();
  }

  /** Smoothed RMS of the mic input (0…1), for level meters. */
  level = 0;
  private lastBlockAt = 0;
  private statusListeners = new Set<() => void>();
  private emitStatus() {
    for (const l of this.statusListeners) l();
  }
  onStatus(l: () => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  /**
   * Whether audio is really reaching the app:
   * - "off": the mic isn't open
   * - "muted": the system muted or closed the mic (another app, a call, Siri, unplugged)
   * - "stalled": the audio engine stopped (suspended/interrupted) and no blocks arrive
   * - "ok": blocks are flowing
   */
  micStatus(): "off" | "muted" | "stalled" | "ok" {
    if (!this.mic) return "off";
    if (!this.micAlive()) return "muted";
    if (!this.ctx || this.ctx.state !== "running" || performance.now() - this.lastBlockAt > 800) return "stalled";
    return "ok";
  }

  /** Tries to get audio flowing again without a gesture (works on desktop and after most iOS interruptions). */
  async recover(): Promise<void> {
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    if (this.mic && !this.micAlive() && this.mic.getAudioTracks().every((t) => t.readyState === "ended")) await this.restartMic().catch(() => {});
  }

  onBlock(l: BlockListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Context time (seconds) of an absolute frame index. */
  frameToTime(frame: number) {
    return frame / this.sampleRate;
  }

  now() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Seconds between scheduling a sound and it leaving the speaker. */
  outputDelay() {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  }

  /** Best guess of the round-trip latency before the user calibrates. */
  defaultLatencyMs() {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!c) return 60;
    return Math.round(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000 + 25);
  }

  playBuffer(data: Float32Array, when = 0, gain = 0.8) {
    if (!this.ctx) return;
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.ctx.destination);
    src.start(when || this.ctx.currentTime);
  }
}

export const audio = new AudioEngine();
