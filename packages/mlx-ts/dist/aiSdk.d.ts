import type { LanguageModelV1 } from "ai";
import { type MlxClientOptions } from "./client.js";
export type MlxAiSdkProviderOptions = MlxClientOptions & {
    /**
     * Where Hugging Face model files should be downloaded.
     * Passed through to mlx-host `model.download`.
     */
    modelsDir?: string;
    /**
     * Automatically download+load the model on first call.
     * Default: true
     */
    autoPrepareModel?: boolean;
};
export declare function createMlxAiSdkProvider(opts?: MlxAiSdkProviderOptions): {
    languageModel(modelId: string): LanguageModelV1;
    textEmbeddingModel(): never;
};
