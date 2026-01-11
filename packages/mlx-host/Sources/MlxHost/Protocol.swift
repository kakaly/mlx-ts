import Foundation

// MARK: - Wire protocol (framed JSON messages)

struct RPCEnvelope: Codable {
    let id: String?
    let type: String
    let payload: JSONValue?
}

/// Lightweight JSON value wrapper so we can keep the wire protocol flexible
/// while still using Codable for the envelope.
enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let b = try? container.decode(Bool.self) { self = .bool(b); return }
        if let d = try? container.decode(Double.self) { self = .number(d); return }
        if let s = try? container.decode(String.self) { self = .string(s); return }
        if let a = try? container.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? container.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let b): try container.encode(b)
        case .number(let n): try container.encode(n)
        case .string(let s): try container.encode(s)
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}

// MARK: - Higher-level request/response payloads (typed internally)

struct ChatMessage: Codable {
    enum Role: String, Codable {
        case system
        case user
        case assistant
    }

    let role: Role
    let content: String
}

struct Sampling: Codable {
    var temperature: Double?
    var topP: Double?
    var topK: Int?
    var repetitionPenalty: Double?
    var seed: UInt64?
}

struct GenerateRequest: Codable {
    let model: String
    let messages: [ChatMessage]
    let maxTokens: Int?
    let stop: [String]?
    let sampling: Sampling?
}

struct GenerateResponse: Codable {
    let requestId: String
    let text: String
    let usage: Usage?
    let timings: Timings?

    struct Usage: Codable {
        let promptTokens: Int?
        let completionTokens: Int?
        let totalTokens: Int?
    }

    struct Timings: Codable {
        let ttftMs: Double?
        let totalMs: Double?
        let tokensPerSecond: Double?
    }
}


