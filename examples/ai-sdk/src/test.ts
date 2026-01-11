import process from "node:process";

import { generateText, streamText } from "ai";

import { createMlxProvider } from "mlx-ts";

async function main() {
  const modelsDir = process.env.MLX_MODELS_DIR;
  const modelId =
    process.env.MLX_HF_REPO ?? "mlx-community/Llama-3.2-1B-Instruct-4bit";

  const mlx = createMlxProvider({
    model: modelId,
    // optional:
    // modelsDir,
    // hostPath: process.env.MLX_HOST_BIN,
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

main()
  .then(() => {
    // `mlx-ts` spawns a long-lived Swift host process; in CLI examples we want to exit once done.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
