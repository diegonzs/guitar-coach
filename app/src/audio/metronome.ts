/** Look-ahead metronome scheduled on the AudioContext clock. */
export interface Beat {
  index: number;
  /** Context time of the click. */
  time: number;
  accent: boolean;
}

export class Metronome {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private index = 0;
  private gain: GainNode;
  readonly clicks: number[] = [];
  private pendingBeats = new Set<ReturnType<typeof setTimeout>>();
  onBeat?: (b: Beat) => void;

  constructor(
    private ctx: AudioContext,
    public bpm: number,
    public beatsPerBar: number,
    volume = 0.6,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
  }

  set volume(v: number) {
    this.gain.gain.value = v;
  }

  get interval() {
    return 60 / this.bpm;
  }

  start(at: number) {
    this.stop();
    this.next = at;
    this.index = 0;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.pendingBeats) clearTimeout(t);
    this.pendingBeats.clear();
  }

  dispose() {
    this.stop();
    this.onBeat = undefined;
    this.gain.disconnect();
  }

  private schedule() {
    while (this.next < this.ctx.currentTime + 0.12) {
      const accent = this.index % this.beatsPerBar === 0;
      this.click(this.next, accent);
      this.clicks.push(this.next);
      if (this.clicks.length > 4000) this.clicks.splice(0, 1000);
      const beat: Beat = { index: this.index, time: this.next, accent };
      const delay = Math.max(0, (this.next - this.ctx.currentTime) * 1000);
      const id = setTimeout(() => {
        this.pendingBeats.delete(id);
        this.onBeat?.(beat);
      }, delay);
      this.pendingBeats.add(id);
      this.next += this.interval;
      this.index++;
    }
  }

  private click(t: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 2600 : 2000;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(accent ? 1 : 0.6, t + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(env).connect(this.gain);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}
