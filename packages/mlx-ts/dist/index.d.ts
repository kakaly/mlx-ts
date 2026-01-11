export type CreateMlxProviderOptions = {
    /**
     * Hugging Face repo id (e.g. "mlx-community/Llama-3.2-3B-Instruct-4bit")
     */
    model: string;
    /**
     * Where to download models (default: os.tmpdir()/mlx-ts-models)
     */
    modelsDir?: string;
    /**
     * Path to mlx-host binary. If not provided, uses the bundled one if present.
     * You can also set MLX_HOST_BIN env var.
     */
    hostPath?: string;
    /**
     * Show mlx-host logs (including download progress) in the user console.
     * Default: true (matches your UX requirement).
     */
    inheritStdio?: boolean;
};
export declare function getBundledMlxHostPath(): string | undefined;
/**
 * UX: `npm i mlx-ts`, then:
 *   const mlx = createMlxProvider({ model: "mlx-community/..." })
 *   const model = mlx.languageModel("mlx-community/...")
 *
 * Note: AI SDK expects the provider to be a factory of models. We scope it to one modelId.
 */
export declare function createMlxProvider(opts: CreateMlxProviderOptions): {
    languageModel(modelId: string): import("ai").LanguageModelV1;
    textEmbeddingModel(): never;
};
