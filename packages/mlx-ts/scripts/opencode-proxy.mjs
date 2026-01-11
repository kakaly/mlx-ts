#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";

import { generateText, streamText } from "ai";
import { createMlxProvider } from "../dist/index.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (buf += chunk));
    req.on("end", () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sseHeaders(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const PORT = Number(args.port ?? process.env.PORT ?? "3755");
  const modelId =
    String(args.model ?? process.env.MLX_MODEL ?? "").trim() ||
    "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit";

  const modelsDir = args.modelsDir ?? process.env.MLX_MODELS_DIR ?? undefined;
  const hostPath = args.hostPath ?? process.env.MLX_HOST_BIN ?? undefined;

  const printConfig = Boolean(args["print-config"] ?? false);
  const providerId = String(args.providerId ?? "mlx").trim() || "mlx";
  const modelKey =
    String(args.modelKey ?? "qwen3-coder-mlx").trim() || "qwen3-coder-mlx";
  const baseURL = `http://127.0.0.1:${PORT}/v1`;

  if (printConfig) {
    // OpenCode custom provider format uses provider_id/model_id ([OpenCode Models docs](https://opencode.ai/docs/models/)).
    // OpenCode custom providers can use @ai-sdk/openai-compatible and a baseURL ([OpenCode Providers docs](https://opencode.ai/docs/providers/#lm-studio)).
    const cfg = {
      $schema: "https://opencode.ai/config.json",
      model: `${providerId}/${modelKey}`,
      provider: {
        [providerId]: {
          npm: "@ai-sdk/openai-compatible",
          name: "MLX (mlx-ts)",
          options: {
            baseURL,
            apiKey: "local",
          },
          models: {
            [modelKey]: {
              name: `MLX: ${modelId}`,
            },
          },
        },
      },
    };
    process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    return;
  }

  const mlx = createMlxProvider({
    model: modelId,
    modelsDir: modelsDir || undefined,
    hostPath: hostPath || undefined,
  });
  const model = mlx.languageModel(modelId);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // Basic CORS (harmless; helps if a UI ever hits this).
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "content-type,authorization"
      );
      if (req.method === "OPTIONS") return res.end();

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, modelId });
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return json(res, 200, {
          object: "list",
          data: [
            {
              id: modelId,
              object: "model",
              created: nowUnix(),
              owned_by: "mlx-ts",
            },
          ],
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = await readJson(req);
        const {
          messages = [],
          stream = false,
          model: reqModel,
          temperature,
          top_p,
          max_tokens,
        } = body ?? {};

        // Enforce single-model server to avoid surprise reinitializations.
        if (reqModel && reqModel !== modelId) {
          return json(res, 400, {
            error: {
              message: `mlx-ts-opencode: server is configured for model '${modelId}', got '${reqModel}'`,
              type: "invalid_request_error",
            },
          });
        }

        if (!stream) {
          const out = await generateText({
            model,
            messages,
            temperature,
            topP: top_p,
            maxTokens: max_tokens,
          });

          return json(res, 200, {
            id: `mlx_${Date.now()}`,
            object: "chat.completion",
            created: nowUnix(),
            model: modelId,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: out.text },
                finish_reason: "stop",
              },
            ],
          });
        }

        sseHeaders(res);
        const s = await streamText({
          model,
          messages,
          temperature,
          topP: top_p,
          maxTokens: max_tokens,
        });

        for await (const chunk of s.textStream) {
          sseWrite(res, {
            id: `mlx_${Date.now()}`,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model: modelId,
            choices: [
              { index: 0, delta: { content: chunk }, finish_reason: null },
            ],
          });
        }

        res.write("data: [DONE]\n\n");
        return res.end();
      }

      return json(res, 404, { error: { message: "not found" } });
    } catch (err) {
      return json(res, 500, {
        error: { message: err?.message ?? String(err), type: "internal_error" },
      });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`mlx-ts-opencode listening on ${baseURL}`);
    console.log(`Model: ${modelId}`);
    console.log(`Health: http://127.0.0.1:${PORT}/health`);
  });
}

main().catch((err) => {
  console.error("mlx-ts-opencode failed:", err);
  process.exit(1);
});
