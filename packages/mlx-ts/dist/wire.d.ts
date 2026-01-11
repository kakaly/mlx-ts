export type RPCEnvelope = {
    id?: string;
    type: string;
    payload?: unknown;
};
export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};
export type Sampling = {
    temperature?: number;
    topP?: number;
    topK?: number;
    repetitionPenalty?: number;
    seed?: number;
};
export type GenerateRequest = {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    stop?: string[];
    sampling?: Sampling;
};
export type GenerateResponse = {
    requestId: string;
    text: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    timings?: {
        ttftMs?: number;
        totalMs?: number;
        tokensPerSecond?: number;
    };
};
export type StreamEvent = {
    type: "start";
    requestId: string;
} | {
    type: "token";
    requestId: string;
    text: string;
} | {
    type: "end";
    requestId: string;
    final: GenerateResponse;
} | {
    type: "error";
    requestId: string;
    message: string;
    code?: string;
};
