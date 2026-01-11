import type { GenerateRequest, GenerateResponse, StreamEvent } from "./wire.js";
export type DownloadSource = {
    kind: "huggingface";
    repo: string;
    revision?: string;
} | {
    kind: "localPath";
    path: string;
};
export type MlxClientOptions = {
    /** Path to the `mlx-host` executable. If provided, the client will spawn it. */
    hostPath?: string;
    /** Where the daemon should create its unix socket. */
    socketPath?: string;
    /** If you run your own daemon, provide its auth token (otherwise one is generated when spawning). */
    authToken?: string;
    /** Stdout/stderr passthrough for debugging. */
    inheritStdio?: boolean;
    /** Optional device override forwarded to mlx-host (cpu/gpu). */
    device?: "cpu" | "gpu";
};
export declare class MlxClient {
    private readonly socketPath;
    private readonly authToken?;
    private readonly hostPath?;
    private readonly inheritStdio;
    private readonly device?;
    private proc?;
    private spawnedAuthToken?;
    private sock?;
    private pending;
    private streamQueues;
    constructor(opts?: MlxClientOptions);
    connect(): Promise<void>;
    close(): Promise<void>;
    downloadModel(source: DownloadSource, opts?: {
        modelsDir?: string;
    }): Promise<{
        model: string;
        localPath: string;
    }>;
    loadModel(model: string): Promise<{
        model: string;
        loaded: true;
    }>;
    unloadModel(model: string): Promise<{
        model: string;
        loaded: false;
    }>;
    deleteModel(model: string): Promise<{
        model: string;
        deleted: true;
    }>;
    listModels(): Promise<{
        cached: string[];
        loaded: string[];
    }>;
    generate(req: GenerateRequest): Promise<GenerateResponse>;
    stream(req: GenerateRequest, opts?: {
        requestId?: string;
    }): AsyncIterable<StreamEvent>;
    cancel(requestId: string): Promise<void>;
    reset(opts?: {
        unloadAll?: boolean;
        clearCache?: boolean;
    }): Promise<void>;
    private spawnHost;
    private handshake;
    private request;
    private sendOnly;
    private onMessage;
    private onClose;
}
