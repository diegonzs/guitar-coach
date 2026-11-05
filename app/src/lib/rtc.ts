/**
 * Phone-as-second-camera over WebRTC. Signalling goes through our server's WebSocket
 * (/ws/signal). No STUN/TURN: both devices are on the same LAN or tailnet, so host
 * candidates are enough and nothing leaves your network.
 */
type Msg = { type: "offer" | "answer"; sdp: string } | { type: "ice"; candidate: RTCIceCandidateInit } | { type: "peer-joined" | "peer-left"; role: string } | { type: "hello" };

function socket(room: string, role: "camera" | "viewer") {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws/signal?room=${encodeURIComponent(room)}&role=${role}`);
}

export type RtcStatus = "connecting" | "waiting" | "connected" | "disconnected" | "error";

/** Laptop side: receives the phone's video. */
export class RemoteCameraViewer {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private closed = false;

  constructor(
    private room: string,
    private onStream: (s: MediaStream | null) => void,
    private onStatus: (s: RtcStatus) => void,
  ) {}

  start() {
    this.onStatus("connecting");
    this.ws = socket(this.room, "viewer");
    this.ws.onopen = () => this.onStatus("waiting");
    this.ws.onclose = () => {
      if (!this.closed) {
        this.onStatus("disconnected");
        setTimeout(() => !this.closed && this.start(), 3000);
      }
    };
    this.ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data) as Msg;
      if (msg.type === "peer-joined" && msg.role === "camera") await this.call();
      else if (msg.type === "peer-left" && msg.role === "camera") {
        this.onStream(null);
        this.onStatus("waiting");
      } else if (msg.type === "answer" && this.pc) await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      else if (msg.type === "ice" && this.pc) await this.pc.addIceCandidate(msg.candidate).catch(() => {});
    };
  }

  private async call() {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (e) => {
      this.onStream(e.streams[0] ?? new MediaStream([e.track]));
      this.onStatus("connected");
    };
    pc.onicecandidate = (e) => e.candidate && this.send({ type: "ice", candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.onStatus("disconnected");
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", sdp: offer.sdp! });
  }

  private send(m: Msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  stop() {
    this.closed = true;
    this.pc?.close();
    this.ws?.close();
    this.onStream(null);
  }
}

/** Phone side: sends its camera. */
export class RemoteCameraSender {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private closed = false;

  constructor(
    private room: string,
    private stream: MediaStream,
    private onStatus: (s: RtcStatus) => void,
  ) {}

  start() {
    this.onStatus("connecting");
    this.ws = socket(this.room, "camera");
    this.ws.onopen = () => this.onStatus("waiting");
    this.ws.onclose = () => {
      if (!this.closed) {
        this.onStatus("disconnected");
        setTimeout(() => !this.closed && this.start(), 3000);
      }
    };
    this.ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data) as Msg;
      if (msg.type === "offer") {
        this.pc?.close();
        const pc = new RTCPeerConnection({ iceServers: [] });
        this.pc = pc;
        for (const t of this.stream.getVideoTracks()) pc.addTrack(t, this.stream);
        pc.onicecandidate = (ev) => ev.candidate && this.send({ type: "ice", candidate: ev.candidate.toJSON() });
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") this.onStatus("connected");
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.onStatus("disconnected");
        };
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: "answer", sdp: answer.sdp! });
      } else if (msg.type === "ice" && this.pc) await this.pc.addIceCandidate(msg.candidate).catch(() => {});
      else if (msg.type === "peer-left") this.onStatus("waiting");
    };
  }

  private send(m: Msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  stop() {
    this.closed = true;
    this.pc?.close();
    this.ws?.close();
  }
}
