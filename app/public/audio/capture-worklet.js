// Captures mic audio in blocks of 1024 samples together with the absolute frame
// index of the first sample, so onsets can be timed against the AudioContext clock.
class GcCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.start = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.start = currentFrame + i;
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) {
        this.port.postMessage({ frame: this.start, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("gc-capture", GcCapture);
