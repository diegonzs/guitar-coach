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
      await this.ctx.audioWorklet.addModule("/audio/capture-worklet.js");
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    return this.ctx;
  }

  /** Starts the microphone (idempotent). */
  async startMic(): Promise<void> {
    if (this.mic && this.mic.getAudioTracks().some((t) => t.readyState === "live")) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const ctx = await this.ensureContext();
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      this.source = ctx.createMediaStreamSource(this.mic);
      this.capture = new AudioWorkletNode(ctx, "gc-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.capture.port.onmessage = (e: MessageEvent<AudioBlock>) => {
        for (const l of this.listeners) l(e.data);
      };
      // keep the worklet pulled by the graph without making any sound
      const mute = ctx.createGain();
      mute.gain.value = 0;
      this.source.connect(this.capture).connect(mute).connect(ctx.destination);
    })().finally(() => (this.starting = null));
    return this.starting;
  }

  stopMic() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.capture?.disconnect();
    this.mic = null;
    this.source = null;
    this.capture = null;
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
