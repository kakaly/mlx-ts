import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMlxAiSdkProvider } from "./aiSdk.js";
export function getBundledMlxHostPath() {
    const p = path.resolve(new URL("../bin/darwin-arm64/mlx-host", import.meta.url).pathname);
    return fs.existsSync(p) ? p : undefined;
}
function defaultModelsDir() {
    const home = os.homedir() || os.tmpdir();
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Caches", "mlx-ts", "models");
    }
    if (process.platform === "win32") {
        const base = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
        return path.join(base, "mlx-ts", "models");
    }
    // linux / other unix
    const xdg = process.env.XDG_CACHE_HOME;
    if (xdg && xdg.trim())
        return path.join(xdg, "mlx-ts", "models");
    return path.join(home, ".cache", "mlx-ts", "models");
}
function resolveModelsDir(opts) {
    const fromOpts = opts.modelsDir?.trim();
    if (fromOpts)
        return fromOpts;
    const fromEnv = process.env.MLX_MODELS_DIR?.trim();
    if (fromEnv)
        return fromEnv;
    return defaultModelsDir();
}
/**
 * UX: `npm i mlx-ts`, then:
 *   const mlx = createMlxProvider({ model: "mlx-community/..." })
 *   const model = mlx.languageModel("mlx-community/...")
 *
 * Note: AI SDK expects the provider to be a factory of models. We scope it to one modelId.
 */
export function createMlxProvider(opts) {
    const modelsDir = resolveModelsDir(opts);
    fs.mkdirSync(modelsDir, { recursive: true });
    const hostPath = opts.hostPath ?? process.env.MLX_HOST_BIN ?? getBundledMlxHostPath();
    if (!hostPath) {
        throw new Error("mlx-ts: mlx-host binary not found. Provide { hostPath } or set MLX_HOST_BIN.");
    }
    const provider = createMlxAiSdkProvider({
        hostPath,
        inheritStdio: opts.inheritStdio ?? true,
        modelsDir,
        autoPrepareModel: true,
    });
    // We return a ProviderV1 that only supports this one modelId.
    return {
        languageModel(modelId) {
            if (modelId !== opts.model) {
                throw new Error(`mlx-ts: this provider instance is configured for model '${opts.model}', got '${modelId}'.`);
            }
            return provider.languageModel(modelId);
        },
        textEmbeddingModel() {
            throw new Error("mlx-ts: embeddings not supported");
        },
    };
}
