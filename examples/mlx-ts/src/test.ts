import process from "node:process";

import { generateText, streamText } from "ai";

// For local development in this repo:
import { createMlxProvider } from "../../../packages/mlx-ts/src/index.js";

async function main() {
  const modelId = process.env.MLX_HF_REPO ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";

  const mlx = createMlxProvider({
    model: modelId,
    // optional:
    // modelsDir: "/tmp/mlx-ts-models",
    // hostPath: "/path/to/mlx-host",
  });

  const model = mlx.languageModel(modelId);

  console.log("\n--- streamText() ---");
  const s = await streamText({
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Write a 1-sentence tagline for a local-first macOS AI app." },
    ],
    maxTokens: 64,
  });

  for await (const chunk of s.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");

  console.log("\n--- generateText() ---");
  const g = await generateText({
    model,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Give me 3 bullet points of key features for that app." },
    ],
    maxTokens: 96,
  });

  console.log(g.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

