import os from "node:os";
import path from "node:path";
import process from "node:process";

import { MlxClient } from "../../../packages/ai-sdk-provider-mlx/src/client.js";

async function main() {
  // 1) Point at your built mlx-host executable
  // Build it with:
  //   cd packages/mlx-host && swift build
  const hostPath =
    process.env.MLX_HOST_BIN ??
    path.resolve(
      process.cwd(),
      "../../packages/mlx-host/.build/debug/mlx-host"
    );

  // 2) Pick a smaller Hugging Face MLX model for testing.
  // Override with:
  //   export MLX_HF_REPO="mlx-community/<some-small-mlx-model>"
  const hfRepo =
    process.env.MLX_HF_REPO ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";
  const modelsDir = (() => {
    const fromEnv = process.env.MLX_MODELS_DIR?.trim();
    if (fromEnv) return fromEnv;
    const home = os.homedir() || os.tmpdir();
    if (process.platform === "darwin") {
      return path.join(home, "Library", "Caches", "mlx-ts", "models");
    }
    if (process.platform === "win32") {
      const base =
        process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      return path.join(base, "mlx-ts", "models");
    }
    const xdg = process.env.XDG_CACHE_HOME?.trim();
    if (xdg) return path.join(xdg, "mlx-ts", "models");
    return path.join(home, ".cache", "mlx-ts", "models");
  })();

  const client = new MlxClient({
    hostPath,
    inheritStdio: true,
  });

  await client.connect();

  // Download model artifacts in pure Swift (Hub snapshot under the hood).
  console.log(
    `downloading model from HF: ${hfRepo} -> ${modelsDir} (first run may take a while)`
  );
  const downloaded = await client.downloadModel(
    { kind: "huggingface", repo: hfRepo },
    { modelsDir }
  );
  console.log("downloaded:", downloaded);

  // Load model into memory
  await client.loadModel(downloaded.model);
  console.log("loaded:", downloaded.model);

  const messages = [
    { role: "system" as const, content: "You are a helpful assistant." },
    {
      role: "user" as const,
      content: "Write a 1-sentence tagline for a local-first macOS AI app.",
    },
  ];

  // 3) Streaming inference
  console.log("\n--- stream() ---");
  for await (const ev of client.stream({
    model: downloaded.model,
    messages,
    maxTokens: 64,
  })) {
    if (ev.type === "start") {
      process.stdout.write("[start]\n");
    } else if (ev.type === "token") {
      process.stdout.write(ev.text);
    } else if (ev.type === "end") {
      process.stdout.write("\n[end]\n");
      console.log("final.timings:", ev.final.timings);
    } else if (ev.type === "error") {
      process.stdout.write("\n[error]\n");
      console.error(ev);
    }
  }

  // 4) One-shot inference
  console.log("\n--- generate() ---");
  const out = await client.generate({
    model: downloaded.model,
    messages,
    maxTokens: 64,
  });
  console.log(out.text);
  console.log("timings:", out.timings);

  // 5) Cleanup
  await client.unloadModel(downloaded.model);
  await client.deleteModel(downloaded.model); // deletes from cache (mock: forgets it)
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
