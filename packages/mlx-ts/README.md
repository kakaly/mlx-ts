## mlx-ts

Local LLM inference on macOS using a **Swift MLX host process** + a **TypeScript client / AI SDK provider**.

> This README is shown on the npm package page. The repo contains additional development notes.

### Quickstart (end users)

**Requirements**

- macOS **Apple Silicon** (`darwin/arm64`)
- Node.js

**Install**

```bash
npm i mlx-ts
```

During install, `mlx-ts` downloads a prebuilt `mlx-host` (Swift) binary + `mlx.metallib` from GitHub Releases (no Xcode required).

**Use with the AI SDK**

```ts
import { createMlxProvider } from "mlx-ts";
import { generateText, streamText } from "ai";

const modelId = "mlx-community/Llama-3.2-1B-Instruct-4bit";

const mlx = createMlxProvider({
  model: modelId,
  // optional:
  // modelsDir: "/path/to/your/models-cache",
  // hostPath: process.env.MLX_HOST_BIN,
});

const model = mlx.languageModel(modelId);

// stream
const s = await streamText({
  model,
  maxTokens: 64,
  messages: [{ role: "user", content: "Say hello from a local MLX model." }],
});
for await (const chunk of s.textStream) process.stdout.write(chunk);
process.stdout.write("\n");

// one-shot
const g = await generateText({
  model,
  maxTokens: 64,
  messages: [{ role: "user", content: "Summarize MLX in one sentence." }],
});
console.log(g.text);
```

### Runtime configuration

- **Force CPU vs GPU**: set `MLX_HOST_DEVICE=cpu` (default is `gpu`).
- **Override host binary**: set `MLX_HOST_BIN=/path/to/mlx-host` or pass `{ hostPath }` to `createMlxProvider`.
- **Default model cache dir**: OS cache directory (macOS: `~/Library/Caches/mlx-ts/models`).
- **Override where models are cached**: pass `{ modelsDir }` to `createMlxProvider` or set `MLX_MODELS_DIR`.
- **Override where `mlx-ts` downloads assets from**: set `MLX_TS_HOST_BASE_URL` (base URL containing `mlx-host` and `mlx.metallib`).

### OpenCode integration

OpenCode supports OpenAI-compatible providers and allows setting `options.baseURL` ([OpenCode Providers](https://opencode.ai/docs/providers/#lm-studio)) and selecting models via `provider_id/model_id` ([OpenCode Models](https://opencode.ai/docs/models/)).

`mlx-ts` ships a small OpenAI-compatible local server:

```bash
# Start local server (choose any MLX model id)
npx mlx-ts-opencode --model mlx-community/Llama-3.2-1B-Instruct-4bit --port 3755

# Generate an opencode.json snippet
npx mlx-ts-opencode --print-config --model mlx-community/Llama-3.2-1B-Instruct-4bit --port 3755 > opencode.json
```

