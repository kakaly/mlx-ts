import type { RPCEnvelope } from "./wire.js";

export function encodeFrame(msg: RPCEnvelope): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function createFrameDecoder(onMessage: (msg: RPCEnvelope) => void) {
  let buf = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      try {
        const msg = JSON.parse(body.toString("utf8")) as RPCEnvelope;
        if (msg && typeof msg.type === "string") onMessage(msg);
      } catch {
        // ignore malformed frames
      }
    }
  };
}

