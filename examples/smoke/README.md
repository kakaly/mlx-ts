## Smoke test (local MLX on macOS + TypeScript)

This repo exposes **local MLX inference** via a Swift daemon (`mlx-host`) and TypeScript APIs.

### Quickstart (no Swift build required)

If you’re an end user, you should not need Xcode at all:

```bash
cd /Users/karthikkalyanaraman/personal-projects/mlx-ts
npm install
```

### AI SDK (recommended UX): `mlx-ts`

This is the intended UX for end users:

- `npm i mlx-ts`
- `createMlxProvider({ model: "mlx-community/..." })`
- auto-downloads to a default temp dir (overrideable)
- prints model download progress (first run)
- on macOS arm64, `mlx-host` is auto-downloaded from GitHub Releases during install (no Swift build required)

Code snippet:

```ts
import { createMlxProvider } from "mlx-ts";
import { streamText, generateText } from "ai";

const modelId = "mlx-community/Llama-3.2-3B-Instruct-4bit";

// Minimal UX: you pass a model id, it downloads locally (first run) and serves chat.
const mlx = createMlxProvider({
  model: modelId,
  // optional overrides:
  // modelsDir: "/tmp/mlx-ts-models",
  // hostPath: process.env.MLX_HOST_BIN,
});

const model = mlx.languageModel(modelId);

// streaming
const s = await streamText({
  model,
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Write a 1-sentence tagline for a local-first macOS AI app." },
  ],
});

for await (const chunk of s.textStream) process.stdout.write(chunk);
process.stdout.write("\n");

// one-shot
const g = await generateText({
  model,
  messages: [{ role: "user", content: "Give me 3 bullet points of key features for that app." }],
});

console.log(g.text);
```

Local run in this repo:

```bash
export MLX_HF_REPO="mlx-community/Llama-3.2-3B-Instruct-4bit"
export MLX_MODELS_DIR="/tmp/mlx-ts-models" # optional override

cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/examples/mlx-ts
npm install
npm run start
```

### AI SDK (advanced / explicit example): `streamText` / `generateText`

Code snippet:

```ts
import { generateText, streamText } from "ai";
import { createMlxProvider } from "mlx-ts";

const modelId = "mlx-community/Llama-3.2-3B-Instruct-4bit";
const mlx = createMlxProvider({
  model: modelId,
  modelsDir: "/tmp/mlx-ts-models",
  // hostPath: process.env.MLX_HOST_BIN,
});
const model = mlx.languageModel(modelId);

const streamed = await streamText({
  model,
  messages: [{ role: "user", content: "Say hello from a local MLX model." }],
});
for await (const chunk of streamed.textStream) process.stdout.write(chunk);

const out = await generateText({
  model,
  messages: [{ role: "user", content: "Summarize this in 1 sentence: MLX runs locally on Apple Silicon." }],
});
console.log(out.text);
```

Local run in this repo:

```bash
export MLX_HF_REPO="mlx-community/Llama-3.2-3B-Instruct-4bit"
export MLX_MODELS_DIR="/tmp/mlx-ts-models" # optional override

cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/examples/ai-sdk
npm install
npm run start
```

### Development: build `mlx-host` locally (GPU / Metal)

> Important: `swift build` (SwiftPM CLI) does **not** build the Metal shaders (`default.metallib`), which can cause runtime failures.
> Use `xcodebuild` for a working GPU build.

```bash
cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/packages/mlx-host
xcodebuild build -scheme mlx-host -destination 'platform=macOS' -configuration Debug

DD=$(ls -td ~/Library/Developer/Xcode/DerivedData/mlx-host-* | head -n 1)
export MLX_HOST_BIN="$DD/Build/Products/Debug/mlx-host"
```


