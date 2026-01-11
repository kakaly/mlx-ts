import type { ChatMessage, GenerateRequest, StreamEvent } from "./wire.js";
import { MlxClient, type MlxClientOptions } from "./client.js";

export type MlxProviderOptions = MlxClientOptions & {
  /** Default model used if none is specified. */
  defaultModel?: string;
};

/**
 * Lightweight provider wrapper (no hard dependency on `ai` at runtime).
 * You can either use this directly, or adapt it to AI SDK custom provider shape.
 *
 * See: https://ai-sdk.dev/providers/community-providers/custom-providers
 */
export function createMlxProvider(opts: MlxProviderOptions = {}) {
  const client = new MlxClient(opts);
  const defaultModel = opts.defaultModel ?? "mock";

  return {
    client,
    /** OpenAI-style chat only */
    chat(model: string = defaultModel) {
      return {
        async generate(args: { messages: ChatMessage[] } & Omit<GenerateRequest, "model" | "messages">) {
          await client.connect();
          return await client.generate({ model, messages: args.messages, maxTokens: args.maxTokens, stop: args.stop, sampling: args.sampling });
        },
        async stream(args: { messages: ChatMessage[] } & Omit<GenerateRequest, "model" | "messages">): Promise<AsyncIterable<StreamEvent>> {
          await client.connect();
          return client.stream({ model, messages: args.messages, maxTokens: args.maxTokens, stop: args.stop, sampling: args.sampling });
        }
      };
    }
  };
}


