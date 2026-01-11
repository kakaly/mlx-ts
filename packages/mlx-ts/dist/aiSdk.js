import { MlxClient } from "./client.js";
function toError(name, message) {
    const e = new Error(message);
    e.name = name;
    return e;
}
function promptToChatMessages(prompt) {
    const out = [];
    for (const msg of prompt) {
        if (msg.role === "system") {
            out.push({ role: "system", content: msg.content });
            continue;
        }
        if (msg.role === "user") {
            let text = "";
            for (const part of msg.content) {
                if (part.type === "text")
                    text += part.text;
                else {
                    throw toError("UnsupportedFunctionalityError", `mlx-ts only supports text user parts. Got: ${part.type}`);
                }
            }
            out.push({ role: "user", content: text });
            continue;
        }
        if (msg.role === "assistant") {
            let text = "";
            for (const part of msg.content) {
                if (part.type === "text")
                    text += part.text;
                else if (part.type === "reasoning")
                    continue;
                else {
                    throw toError("UnsupportedFunctionalityError", `mlx-ts does not support assistant part: ${part.type}`);
                }
            }
            out.push({ role: "assistant", content: text });
            continue;
        }
        throw toError("UnsupportedFunctionalityError", `mlx-ts does not support role: ${msg.role}`);
    }
    return out;
}
function warningsFor(options) {
    const warnings = [];
    if (options.topK != null)
        warnings.push({
            type: "unsupported-setting",
            setting: "topK",
            details: "MLXLMCommon does not expose topK in GenerateParameters.",
        });
    if (options.seed != null)
        warnings.push({
            type: "unsupported-setting",
            setting: "seed",
            details: "MLXLMCommon does not expose seed in GenerateParameters.",
        });
    if (options.presencePenalty != null)
        warnings.push({ type: "unsupported-setting", setting: "presencePenalty" });
    if (options.frequencyPenalty != null)
        warnings.push({ type: "unsupported-setting", setting: "frequencyPenalty" });
    if (options.responseFormat?.type === "json")
        warnings.push({
            type: "unsupported-setting",
            setting: "responseFormat",
            details: "Structured outputs not implemented.",
        });
    if (options.mode?.type !== "regular")
        warnings.push({
            type: "other",
            message: "Non-regular generation modes are not supported; falling back to regular text generation.",
        });
    return warnings;
}
export function createMlxAiSdkProvider(opts = {}) {
    const providerName = "mlx-ts";
    const client = new MlxClient(opts);
    const autoPrepareModel = opts.autoPrepareModel ?? true;
    async function ensurePrepared(modelId) {
        if (!autoPrepareModel)
            return;
        await client.connect();
        await client.downloadModel({ kind: "huggingface", repo: modelId }, { modelsDir: opts.modelsDir });
        await client.loadModel(modelId);
    }
    return {
        languageModel(modelId) {
            if (!modelId) {
                throw toError("NoSuchModelError", "modelId is required");
            }
            return {
                specificationVersion: "v1",
                provider: providerName,
                modelId,
                defaultObjectGenerationMode: undefined,
                supportsStructuredOutputs: false,
                async doGenerate(options) {
                    const warnings = warningsFor(options);
                    try {
                        await ensurePrepared(modelId);
                        const messages = promptToChatMessages(options.prompt);
                        const out = await client.generate({
                            model: modelId,
                            messages,
                            maxTokens: options.maxTokens,
                            stop: options.stopSequences,
                            sampling: {
                                temperature: options.temperature,
                                topP: options.topP,
                            },
                        });
                        return {
                            text: out.text ?? "",
                            finishReason: "stop",
                            usage: {
                                promptTokens: out.usage?.promptTokens ?? 0,
                                completionTokens: out.usage?.completionTokens ?? 0,
                            },
                            rawCall: {
                                rawPrompt: options.prompt,
                                rawSettings: {
                                    maxTokens: options.maxTokens,
                                    temperature: options.temperature,
                                    topP: options.topP,
                                    stopSequences: options.stopSequences,
                                },
                            },
                            response: {
                                id: out.requestId,
                                timestamp: new Date(),
                                modelId,
                            },
                            warnings,
                            providerMetadata: {
                                [providerName]: {
                                    timings: out.timings,
                                },
                            },
                        };
                    }
                    catch (err) {
                        throw toError("InvalidPromptError", String(err?.message ?? err));
                    }
                },
                async doStream(options) {
                    const warnings = warningsFor(options);
                    const requestId = cryptoRandomId();
                    await ensurePrepared(modelId);
                    const stream = new ReadableStream({
                        start: async (controller) => {
                            const abort = options.abortSignal;
                            const onAbort = () => {
                                void client.cancel(requestId).catch(() => { });
                                controller.enqueue({ type: "error", error: toError("AbortError", "aborted") });
                                controller.close();
                            };
                            if (abort) {
                                if (abort.aborted)
                                    return onAbort();
                                abort.addEventListener("abort", onAbort, { once: true });
                            }
                            try {
                                const messages = promptToChatMessages(options.prompt);
                                for await (const ev of client.stream({
                                    model: modelId,
                                    messages,
                                    maxTokens: options.maxTokens,
                                    stop: options.stopSequences,
                                    sampling: {
                                        temperature: options.temperature,
                                        topP: options.topP,
                                    },
                                }, { requestId })) {
                                    if (ev.type === "token") {
                                        controller.enqueue({ type: "text-delta", textDelta: ev.text });
                                    }
                                    else if (ev.type === "end") {
                                        controller.enqueue({
                                            type: "response-metadata",
                                            id: ev.final.requestId,
                                            timestamp: new Date(),
                                            modelId,
                                        });
                                        controller.enqueue({
                                            type: "finish",
                                            finishReason: "stop",
                                            usage: {
                                                promptTokens: ev.final.usage?.promptTokens ?? 0,
                                                completionTokens: ev.final.usage?.completionTokens ?? 0,
                                            },
                                            providerMetadata: {
                                                [providerName]: {
                                                    timings: ev.final.timings,
                                                },
                                            },
                                        });
                                    }
                                    else if (ev.type === "error") {
                                        controller.enqueue({ type: "error", error: toError(ev.code ?? "error", ev.message) });
                                    }
                                }
                            }
                            catch (err) {
                                controller.enqueue({ type: "error", error: err });
                            }
                            finally {
                                controller.close();
                            }
                        },
                    });
                    return {
                        stream,
                        rawCall: {
                            rawPrompt: options.prompt,
                            rawSettings: {
                                maxTokens: options.maxTokens,
                                temperature: options.temperature,
                                topP: options.topP,
                                stopSequences: options.stopSequences,
                            },
                        },
                        warnings,
                    };
                },
            };
        },
        textEmbeddingModel() {
            throw toError("NoSuchModelError", "textEmbeddingModel not supported");
        },
    };
}
function cryptoRandomId() {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
