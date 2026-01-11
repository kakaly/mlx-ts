import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createFrameDecoder, encodeFrame } from "./framing.js";
import type {
  GenerateRequest,
  GenerateResponse,
  RPCEnvelope,
  StreamEvent,
} from "./wire.js";

export type DownloadSource =
  | { kind: "huggingface"; repo: string; revision?: string }
  | { kind: "localPath"; path: string };

export type MlxClientOptions = {
  /** Path to the `mlx-host` executable. If provided, the client will spawn it. */
  hostPath?: string;
  /** Where the daemon should create its unix socket. */
  socketPath?: string;
  /** If you run your own daemon, provide its auth token (otherwise one is generated when spawning). */
  authToken?: string;
  /** Stdout/stderr passthrough for debugging. */
  inheritStdio?: boolean;
};

export class MlxClient {
  private readonly socketPath: string;
  private readonly authToken?: string;
  private readonly hostPath?: string;
  private readonly inheritStdio: boolean;

  private proc?: ChildProcessWithoutNullStreams;
  private spawnedAuthToken?: string;
  private sock?: net.Socket;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >();
  private streamQueues = new Map<string, Array<(ev: StreamEvent) => void>>();

  constructor(opts: MlxClientOptions = {}) {
    this.hostPath = opts.hostPath;
    this.socketPath =
      opts.socketPath ?? path.join(os.tmpdir(), `mlx-host-${process.pid}.sock`);
    this.authToken = opts.authToken;
    this.inheritStdio = opts.inheritStdio ?? false;
  }

  async connect(): Promise<void> {
    if (this.sock?.readyState === "open") return;

    if (this.hostPath) {
      const token = this.authToken ?? crypto.randomBytes(24).toString("hex");
      this.spawnHost({ authToken: token });
    }

    const connectOnce = () =>
      new Promise<void>((resolve, reject) => {
        const sock = net.createConnection({ path: this.socketPath });
        this.sock = sock;

        sock.once("error", reject);
        sock.once("connect", () => resolve());

        const decode = createFrameDecoder((msg) => this.onMessage(msg));
        sock.on("data", (chunk) => decode(chunk));
        sock.on("close", () => this.onClose(new Error("socket closed")));
        sock.on("error", (err) => this.onClose(err));
      });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      // If we spawned the host, the socket may not exist yet. Retry briefly.
      const deadline = Date.now() + (this.proc ? 3000 : 0);
      while (true) {
        try {
          await connectOnce();
          break;
        } catch (err: any) {
          const code = String(err?.code ?? "");
          if (!this.proc) throw err;
          if (Date.now() > deadline) throw err;
          if (code === "ENOENT" || code === "ECONNREFUSED") {
            await sleep(25);
            continue;
          }
          throw err;
        }
      }

      if (this.authToken) {
        await this.handshake(this.authToken);
      } else if (this.proc) {
        // spawned host uses generated token
        await this.handshake(this.spawnedAuthToken!);
      }
    } catch (err) {
      // If we spawned a daemon but failed to connect/handshake, don't leak it.
      if (this.proc) {
        try {
          this.proc.kill();
        } catch {
          // ignore
        }
        this.proc = undefined;
      }
      this.sock?.destroy();
      this.sock = undefined;
      throw err;
    }
  }

  async close(): Promise<void> {
    this.sock?.destroy();
    this.sock = undefined;
    if (this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }
  }

  async downloadModel(
    source: DownloadSource,
    opts?: { modelsDir?: string }
  ): Promise<{ model: string; localPath: string }> {
    const res = await this.request("model.download", {
      source,
      modelsDir: opts?.modelsDir,
    });
    return { model: String(res.model), localPath: String(res.localPath) };
  }

  async loadModel(model: string): Promise<{ model: string; loaded: true }> {
    const res = await this.request("model.load", { model });
    return { model: String(res.model), loaded: true };
  }

  async unloadModel(model: string): Promise<{ model: string; loaded: false }> {
    const res = await this.request("model.unload", { model });
    return { model: String(res.model), loaded: false };
  }

  async deleteModel(model: string): Promise<{ model: string; deleted: true }> {
    const res = await this.request("model.delete", { model });
    return { model: String(res.model), deleted: true };
  }

  async listModels(): Promise<{ cached: string[]; loaded: string[] }> {
    const res = await this.request("model.list", {});
    return {
      cached: (res.cached ?? []).map(String),
      loaded: (res.loaded ?? []).map(String),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const id = crypto.randomUUID();
    const res = await this.request("inference.generate", req, id);
    return res as GenerateResponse;
  }

  stream(
    req: GenerateRequest,
    opts?: { requestId?: string }
  ): AsyncIterable<StreamEvent> {
    const id = opts?.requestId ?? crypto.randomUUID();
    const queue: StreamEvent[] = [];
    const waiters: Array<(ev: StreamEvent) => void> = [];
    let finished = false;

    const push = (ev: StreamEvent) => {
      const waiter = waiters.shift();
      if (waiter) waiter(ev);
      else queue.push(ev);
    };

    this.streamQueues.set(id, [push]);

    try {
      this.sendOnly("inference.stream", req, id);
    } catch (err: any) {
      push({
        type: "error",
        requestId: id,
        message: String(err?.message ?? err),
        code: "client_error",
      });
    }

    const iter: AsyncIterable<StreamEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (finished) return { value: undefined as any, done: true };
          if (queue.length > 0) return { value: queue.shift()!, done: false };
          const ev = await new Promise<StreamEvent>((resolve) =>
            waiters.push(resolve)
          );
          if (ev.type === "end" || ev.type === "error") {
            this.streamQueues.delete(id);
            finished = true;
          }
          return { value: ev, done: false };
        },
      }),
    };
    return iter;
  }

  async cancel(requestId: string): Promise<void> {
    await this.request("inference.cancel", { requestId });
  }

  async reset(opts?: {
    unloadAll?: boolean;
    clearCache?: boolean;
  }): Promise<void> {
    await this.request("reset", opts ?? {});
  }

  // ---- private ----

  private spawnHost(opts: { authToken: string }) {
    const p = spawn(this.hostPath!, ["--socket", this.socketPath], {
      env: {
        ...process.env,
        MLX_HOST_SOCKET_PATH: this.socketPath,
        MLX_HOST_AUTH_TOKEN: opts.authToken,
      },
      stdio: this.inheritStdio ? "inherit" : "pipe",
    });
    this.spawnedAuthToken = opts.authToken;
    this.proc = p;
  }

  private async handshake(authToken: string): Promise<void> {
    await this.request("handshake", { authToken });
  }

  private request(
    type: string,
    payload: unknown,
    id: string = crypto.randomUUID()
  ): Promise<any> {
    if (!this.sock) throw new Error("Not connected");
    const env: RPCEnvelope = { id, type, payload };
    const frame = encodeFrame(env);

    const p = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.sock.write(frame);
    return p;
  }

  private sendOnly(
    type: string,
    payload: unknown,
    id: string = crypto.randomUUID()
  ): void {
    if (!this.sock) throw new Error("Not connected");
    const env: RPCEnvelope = { id, type, payload };
    const frame = encodeFrame(env);
    this.sock.write(frame);
  }

  private onMessage(msg: RPCEnvelope) {
    const id = msg.id;

    // Stream events (identified by inference.stream.*)
    if (
      id &&
      typeof msg.type === "string" &&
      msg.type.startsWith("inference.stream.")
    ) {
      const payload: any = msg.payload ?? {};
      const requestId = String(payload.requestId ?? id);
      const pushers =
        this.streamQueues.get(id) ?? this.streamQueues.get(requestId);
      if (!pushers) return;

      if (msg.type === "inference.stream.start") {
        pushers.forEach((p) => p({ type: "start", requestId }));
      } else if (msg.type === "inference.stream.token") {
        pushers.forEach((p) =>
          p({ type: "token", requestId, text: String(payload.text ?? "") })
        );
      } else if (msg.type === "inference.stream.end") {
        pushers.forEach((p) =>
          p({
            type: "end",
            requestId,
            final: payload.final as GenerateResponse,
          })
        );
      } else if (msg.type === "inference.stream.error") {
        pushers.forEach((p) =>
          p({
            type: "error",
            requestId,
            message: String(payload.message ?? "error"),
            code: String(payload.code ?? "error"),
          })
        );
      }
      return;
    }

    if (!id) return;

    // Normal request responses
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);

    if (msg.type === "error") {
      const p: any = msg.payload ?? {};
      const e = new Error(String(p.message ?? "Unknown error"));
      (e as any).code = p.code;
      pending.reject(e);
      return;
    }

    // unwrap *.ok payloads
    pending.resolve(msg.payload ?? {});
  }

  private onClose(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
