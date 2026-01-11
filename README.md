## mlx-ts

Local LLM inference on macOS using a **Swift MLX host process** + a **TypeScript client / AI SDK provider**.

### Packages

- `packages/mlx-host`: Swift executable that exposes a low-latency Unix socket RPC API (framed JSON) for model lifecycle + streaming generation.
- `packages/ai-sdk-provider-mlx`: TypeScript client and AI SDK custom provider wrapper.

### Status

This repo currently ships a **mock engine** (streams a synthetic response) to validate the transport + API shape.
The engine is structured so you can swap in a real MLX Swift LLM implementation (e.g. via `mlx-swift-lm`) without changing the TS surface area.


