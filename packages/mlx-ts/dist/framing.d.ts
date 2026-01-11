import type { RPCEnvelope } from "./wire.js";
export declare function encodeFrame(msg: RPCEnvelope): Buffer;
export declare function createFrameDecoder(onMessage: (msg: RPCEnvelope) => void): (chunk: Buffer) => void;
