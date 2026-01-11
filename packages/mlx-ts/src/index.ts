import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { createMlxAiSdkProvider } from "./aiSdk.js";

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

export function getBundledMlxHostPath(): string | undefined {
  const p = path.resolve(
    new URL("../bin/darwin-arm64/mlx-host", import.meta.url).pathname
  );
  return fs.existsSync(p) ? p : undefined;
}

/**
 * UX: `npm i mlx-ts`, then:
 *   const mlx = createMlxProvider({ model: "mlx-community/..." })
 *   const model = mlx.languageModel("mlx-community/...")
 *
 * Note: AI SDK expects the provider to be a factory of models. We scope it to one modelId.
 */
export function createMlxProvider(opts: CreateMlxProviderOptions) {
  const modelsDir = opts.modelsDir ?? path.join(os.tmpdir(), "mlx-ts-models");
  const hostPath =
    opts.hostPath ??
    process.env.MLX_HOST_BIN ??
    getBundledMlxHostPath();

  if (!hostPath) {
    throw new Error(
      "mlx-ts: mlx-host binary not found. Provide { hostPath } or set MLX_HOST_BIN."
    );
  }

  const provider = createMlxAiSdkProvider({
    hostPath,
    inheritStdio: opts.inheritStdio ?? true,
    modelsDir,
    autoPrepareModel: true,
  });

  // We return a ProviderV1 that only supports this one modelId.
  return {
    languageModel(modelId: string) {
      if (modelId !== opts.model) {
        throw new Error(
          `mlx-ts: this provider instance is configured for model '${opts.model}', got '${modelId}'.`
        );
      }
      return provider.languageModel(modelId);
    },
    textEmbeddingModel() {
      throw new Error("mlx-ts: embeddings not supported");
    },
  };
}

