import net from "node:net";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createFrameDecoder, encodeFrame } from "./framing.js";
export class MlxClient {
    socketPath;
    authToken;
    hostPath;
    inheritStdio;
    device;
    proc;
    spawnedAuthToken;
    sock;
    pending = new Map();
    streamQueues = new Map();
    constructor(opts = {}) {
        this.hostPath = opts.hostPath;
        this.socketPath = opts.socketPath ?? path.join(os.tmpdir(), `mlx-host-${process.pid}.sock`);
        this.authToken = opts.authToken;
        this.inheritStdio = opts.inheritStdio ?? false;
        this.device = opts.device;
    }
    async connect() {
        if (this.sock?.readyState === "open")
            return;
        if (this.hostPath) {
            const token = this.authToken ?? crypto.randomBytes(24).toString("hex");
            this.spawnHost({ authToken: token });
        }
        const connectOnce = () => new Promise((resolve, reject) => {
            const sock = net.createConnection({ path: this.socketPath });
            this.sock = sock;
            sock.once("error", reject);
            sock.once("connect", () => resolve());
            const decode = createFrameDecoder((msg) => this.onMessage(msg));
            sock.on("data", (chunk) => decode(chunk));
            sock.on("close", () => this.onClose(new Error("socket closed")));
            sock.on("error", (err) => this.onClose(err));
        });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        try {
            // If we spawned the host, the socket may not exist yet. Retry briefly.
            const deadline = Date.now() + (this.proc ? 3000 : 0);
            while (true) {
                try {
                    await connectOnce();
                    break;
                }
                catch (err) {
                    const code = String(err?.code ?? "");
                    if (!this.proc)
                        throw err;
                    if (Date.now() > deadline)
                        throw err;
                    if (code === "ENOENT" || code === "ECONNREFUSED") {
                        await sleep(25);
                        continue;
                    }
                    throw err;
                }
            }
            if (this.authToken) {
                await this.handshake(this.authToken);
            }
            else if (this.proc) {
                // spawned host uses generated token
                await this.handshake(this.spawnedAuthToken);
            }
        }
        catch (err) {
            // If we spawned a daemon but failed to connect/handshake, don't leak it.
            if (this.proc) {
                try {
                    this.proc.kill();
                }
                catch { }
                this.proc = undefined;
            }
            this.sock?.destroy();
            this.sock = undefined;
            throw err;
        }
    }
    async close() {
        this.sock?.destroy();
        this.sock = undefined;
        if (this.proc) {
            this.proc.kill();
            this.proc = undefined;
        }
    }
    async downloadModel(source, opts) {
        const res = await this.request("model.download", { source, modelsDir: opts?.modelsDir });
        return { model: String(res.model), localPath: String(res.localPath) };
    }
    async loadModel(model) {
        const res = await this.request("model.load", { model });
        return { model: String(res.model), loaded: true };
    }
    async unloadModel(model) {
        const res = await this.request("model.unload", { model });
        return { model: String(res.model), loaded: false };
    }
    async deleteModel(model) {
        const res = await this.request("model.delete", { model });
        return { model: String(res.model), deleted: true };
    }
    async listModels() {
        const res = await this.request("model.list", {});
        return { cached: (res.cached ?? []).map(String), loaded: (res.loaded ?? []).map(String) };
    }
    async generate(req) {
        const id = crypto.randomUUID();
        const res = await this.request("inference.generate", req, id);
        return res;
    }
    stream(req, opts) {
        const id = opts?.requestId ?? crypto.randomUUID();
        const queue = [];
        const waiters = [];
        let finished = false;
        const push = (ev) => {
            const waiter = waiters.shift();
            if (waiter)
                waiter(ev);
            else
                queue.push(ev);
        };
        this.streamQueues.set(id, [push]);
        try {
            this.sendOnly("inference.stream", req, id);
        }
        catch (err) {
            push({ type: "error", requestId: id, message: String(err?.message ?? err), code: "client_error" });
        }
        const iter = {
            [Symbol.asyncIterator]: () => ({
                next: async () => {
                    if (finished)
                        return { value: undefined, done: true };
                    if (queue.length > 0)
                        return { value: queue.shift(), done: false };
                    const ev = await new Promise((resolve) => waiters.push(resolve));
                    if (ev.type === "end" || ev.type === "error") {
                        this.streamQueues.delete(id);
                        finished = true;
                    }
                    return { value: ev, done: false };
                }
            })
        };
        return iter;
    }
    async cancel(requestId) {
        await this.request("inference.cancel", { requestId });
    }
    async reset(opts) {
        await this.request("reset", opts ?? {});
    }
    // ---- private ----
    spawnHost(opts) {
        const p = spawn(this.hostPath, ["--socket", this.socketPath], {
            env: {
                ...process.env,
                MLX_HOST_SOCKET_PATH: this.socketPath,
                MLX_HOST_AUTH_TOKEN: opts.authToken,
                ...(this.device ? { MLX_HOST_DEVICE: this.device } : {}),
            },
            stdio: this.inheritStdio ? "inherit" : "pipe"
        });
        this.spawnedAuthToken = opts.authToken;
        this.proc = p;
    }
    async handshake(authToken) {
        await this.request("handshake", { authToken });
    }
    request(type, payload, id = crypto.randomUUID()) {
        if (!this.sock)
            throw new Error("Not connected");
        const env = { id, type, payload };
        const frame = encodeFrame(env);
        const p = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        this.sock.write(frame);
        return p;
    }
    sendOnly(type, payload, id = crypto.randomUUID()) {
        if (!this.sock)
            throw new Error("Not connected");
        const env = { id, type, payload };
        const frame = encodeFrame(env);
        this.sock.write(frame);
    }
    onMessage(msg) {
        const id = msg.id;
        // Stream events (identified by inference.stream.*)
        if (id && typeof msg.type === "string" && msg.type.startsWith("inference.stream.")) {
            const payload = msg.payload ?? {};
            const requestId = String(payload.requestId ?? id);
            const pushers = this.streamQueues.get(id) ?? this.streamQueues.get(requestId);
            if (!pushers)
                return;
            if (msg.type === "inference.stream.start") {
                pushers.forEach((p) => p({ type: "start", requestId }));
            }
            else if (msg.type === "inference.stream.token") {
                pushers.forEach((p) => p({ type: "token", requestId, text: String(payload.text ?? "") }));
            }
            else if (msg.type === "inference.stream.end") {
                pushers.forEach((p) => p({ type: "end", requestId, final: payload.final }));
            }
            else if (msg.type === "inference.stream.error") {
                pushers.forEach((p) => p({ type: "error", requestId, message: String(payload.message ?? "error"), code: String(payload.code ?? "error") }));
            }
            return;
        }
        if (!id)
            return;
        // Normal request responses
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        if (msg.type === "error") {
            const p = msg.payload ?? {};
            const e = new Error(String(p.message ?? "Unknown error"));
            e.code = p.code;
            pending.reject(e);
            return;
        }
        pending.resolve(msg.payload ?? {});
    }
    onClose(err) {
        for (const [, p] of this.pending)
            p.reject(err);
        this.pending.clear();
    }
}
