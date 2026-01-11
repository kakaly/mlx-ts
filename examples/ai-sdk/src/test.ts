import os from "node:os";
import path from "node:path";
import process from "node:process";

import { generateText, streamText } from "ai";

import { createMlxProvider } from "../../../packages/ai-sdk-provider-mlx/src/aiSdk.js";

async function main() {
  // Use the metallib-enabled binary produced by xcodebuild, or set MLX_HOST_BIN manually.
  const hostBin =
    process.env.MLX_HOST_BIN ??
    path.resolve(
      process.cwd(),
      "../../packages/mlx-host/.build/debug/mlx-host"
    );

  const modelsDir =
    process.env.MLX_MODELS_DIR ?? path.join(os.tmpdir(), "mlx-ts-models");
  const modelId =
    process.env.MLX_HF_REPO ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";

  const mlx = createMlxProvider({
    hostPath: hostBin,
    inheritStdio: true,
    modelsDir,
  });

  const model = mlx.languageModel(modelId);

  console.log("\n--- AI SDK streamText() ---");
  const streamRes = await streamText({
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "Give me a 1-sentence tagline for a local-first macOS AI app.",
      },
    ],
    maxTokens: 64,
  });

  for await (const part of streamRes.textStream) {
    process.stdout.write(part);
  }
  process.stdout.write("\n");

  console.log("\n--- AI SDK generateText() ---");
  const genRes = await generateText({
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "Write a single-sentence elevator pitch for the same app.",
      },
    ],
    maxTokens: 64,
  });

  console.log(genRes.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
