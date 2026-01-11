import Foundation
import Dispatch
import Darwin

final class MlxHostServer {
    private let socketPath: String
    private let authToken: String?
    private let engine: LLMEngine

    private var listenerFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?

    private final class ConnectionContext {
        var isAuthed: Bool
        init(isAuthed: Bool) { self.isAuthed = isAuthed }
    }

    init(socketPath: String, authToken: String?, engine: LLMEngine) {
        self.socketPath = socketPath
        self.authToken = authToken
        self.engine = engine
    }

    func start() throws {
        // Remove stale socket.
        try? FileManager.default.removeItem(atPath: socketPath)
        listenerFD = socket(AF_UNIX, SOCK_STREAM, 0)
        if listenerFD < 0 {
            throw NSError(domain: "mlx-host", code: 500, userInfo: [NSLocalizedDescriptionKey: "socket() failed"])
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8) + [0]
        if pathBytes.count > MemoryLayout.size(ofValue: addr.sun_path) {
            throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Socket path too long"])
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let raw = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: UInt8.self)
            for i in 0..<pathBytes.count { raw[i] = pathBytes[i] }
        }

        var sockaddr = sockaddr()
        memcpy(&sockaddr, &addr, MemoryLayout<sockaddr_un>.size)
        let bindResult = withUnsafePointer(to: &sockaddr) { ptr -> Int32 in
            let socklen = socklen_t(MemoryLayout<sockaddr_un>.size)
            return Darwin.bind(listenerFD, ptr, socklen)
        }
        if bindResult != 0 {
            throw NSError(domain: "mlx-host", code: 500, userInfo: [NSLocalizedDescriptionKey: "bind() failed"])
        }
        if listen(listenerFD, 128) != 0 {
            throw NSError(domain: "mlx-host", code: 500, userInfo: [NSLocalizedDescriptionKey: "listen() failed"])
        }

        // Non-blocking accept so the DispatchSource handler can't hang.
        _ = fcntl(listenerFD, F_SETFL, O_NONBLOCK)

        acceptSource = DispatchSource.makeReadSource(fileDescriptor: listenerFD, queue: .global())
        acceptSource?.setEventHandler { [weak self] in
            guard let self else { return }
            self.acceptConnections()
        }
        acceptSource?.setCancelHandler { [fd = listenerFD] in
            if fd >= 0 { close(fd) }
        }
        acceptSource?.resume()
    }

    func stop() {
        acceptSource?.cancel()
        acceptSource = nil
        try? FileManager.default.removeItem(atPath: socketPath)
    }

    private func acceptConnections() {
        while true {
            var addr = sockaddr()
            var len: socklen_t = socklen_t(MemoryLayout<sockaddr>.size)
            let fd = Darwin.accept(listenerFD, &addr, &len)
            if fd < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK { return }
                return
            }
            handleNewConnection(Int32(fd))
        }
    }

    private func handleNewConnection(_ fd: Int32) {
        let conn = FramedJSONConnection(socketFD: fd)
        let ctx = ConnectionContext(isAuthed: authToken == nil)

        conn.onClose = { _ in
            conn.stop()
        }

        conn.onMessage = { [weak self] envelope in
            guard let self else { return }

            // Require handshake if token configured.
            if !ctx.isAuthed {
                if envelope.type != "handshake" {
                    conn.send(.init(id: envelope.id, type: "error", payload: .object([
                        "code": .string("unauthorized"),
                        "message": .string("Handshake required")
                    ])))
                    conn.stop()
                    return
                }
            }

            Task {
                await self.handleMessage(envelope, conn: conn, ctx: ctx)
            }
        }

        conn.start()
    }

    private func handleMessage(_ envelope: RPCEnvelope, conn: FramedJSONConnection, ctx: ConnectionContext) async {
        let requestId = envelope.id ?? UUID().uuidString

        func sendError(_ code: String, _ message: String) {
            conn.send(.init(id: requestId, type: "error", payload: .object([
                "code": .string(code),
                "message": .string(message)
            ])))
        }

        do {
            switch envelope.type {
            case "handshake":
                if let authToken {
                    guard
                        let payload = envelope.payload,
                        case .object(let obj) = payload,
                        case .string(let token)? = obj["authToken"],
                        token == authToken
                    else {
                        sendError("unauthorized", "Invalid auth token")
                        conn.stop()
                        return
                    }
                }
                ctx.isAuthed = true
                conn.send(.init(id: requestId, type: "handshake.ok", payload: .object([
                    "serverVersion": .string("0.1.0"),
                    "capabilities": .object([
                        "chatCompletions": .bool(true),
                        "stream": .bool(true),
                        "download": .bool(true)
                    ])
                ])))

            case "model.download":
                let modelsDir: String? = {
                    guard let payload = envelope.payload, case .object(let obj) = payload else { return nil }
                    guard case .string(let dir)? = obj["modelsDir"] else { return nil }
                    return dir
                }()
                let source: JSONValue? = {
                    guard let payload = envelope.payload, case .object(let obj) = payload else { return nil }
                    return obj["source"]
                }()
                let out = try await engine.downloadModel(source: source, modelsDir: modelsDir)
                conn.send(.init(id: requestId, type: "model.download.ok", payload: .object([
                    "model": .string(out.model),
                    "localPath": .string(out.localPath)
                ])))

            case "model.load":
                let model = try requireString(envelope.payload, key: "model")
                try await engine.loadModel(model: model)
                conn.send(.init(id: requestId, type: "model.load.ok", payload: .object([
                    "model": .string(model),
                    "loaded": .bool(true)
                ])))

            case "model.unload":
                let model = try requireString(envelope.payload, key: "model")
                try await engine.unloadModel(model: model)
                conn.send(.init(id: requestId, type: "model.unload.ok", payload: .object([
                    "model": .string(model),
                    "loaded": .bool(false)
                ])))

            case "model.delete":
                let model = try requireString(envelope.payload, key: "model")
                try await engine.deleteModel(model: model)
                conn.send(.init(id: requestId, type: "model.delete.ok", payload: .object([
                    "model": .string(model),
                    "deleted": .bool(true)
                ])))

            case "model.list":
                let res = await engine.listModels()
                conn.send(.init(id: requestId, type: "model.list.ok", payload: .object([
                    "cached": .array(res.cached.map { .string($0) }),
                    "loaded": .array(res.loaded.map { .string($0) })
                ])))

            case "inference.generate":
                let req = try decodePayload(GenerateRequest.self, from: envelope.payload)
                let res = try await engine.generate(requestId: requestId, request: req)
                conn.send(.init(id: requestId, type: "inference.generate.ok", payload: try encodePayload(res)))

            case "inference.stream":
                let req = try decodePayload(GenerateRequest.self, from: envelope.payload)
                conn.send(.init(id: requestId, type: "inference.stream.start", payload: .object(["requestId": .string(requestId)])))
                do {
                    let start = Date()
                    var ttft: TimeInterval?
                    var out = ""
                    var chunkCount = 0
                    let stream = await engine.stream(requestId: requestId, request: req)
                    for try await chunk in stream {
                        if ttft == nil { ttft = Date().timeIntervalSince(start) }
                        out += chunk
                        chunkCount += 1
                        conn.send(.init(id: requestId, type: "inference.stream.token", payload: .object([
                            "requestId": .string(requestId),
                            "text": .string(chunk)
                        ])))
                    }
                    let total = Date().timeIntervalSince(start)
                    let tps: Double? = total > 0 ? Double(chunkCount) / total : nil
                    let final = GenerateResponse(
                        requestId: requestId,
                        text: out,
                        usage: .init(promptTokens: nil, completionTokens: chunkCount, totalTokens: nil),
                        timings: .init(ttftMs: (ttft ?? total) * 1000.0, totalMs: total * 1000.0, tokensPerSecond: tps)
                    )
                    conn.send(.init(id: requestId, type: "inference.stream.end", payload: .object([
                        "requestId": .string(requestId),
                        "final": try encodePayload(final)
                    ])))
                } catch {
                    conn.send(.init(id: requestId, type: "inference.stream.error", payload: .object([
                        "requestId": .string(requestId),
                        "message": .string(error.localizedDescription),
                        "code": .string("stream_error")
                    ])))
                }

            case "inference.cancel":
                let id = try requireString(envelope.payload, key: "requestId")
                await engine.cancel(requestId: id)
                conn.send(.init(id: requestId, type: "inference.cancel.ok", payload: .object([
                    "requestId": .string(id),
                    "cancelled": .bool(true)
                ])))

            case "reset":
                let unloadAll = try optionalBool(envelope.payload, key: "unloadAll") ?? true
                let clearCache = try optionalBool(envelope.payload, key: "clearCache") ?? false
                await engine.reset(unloadAll: unloadAll, clearCache: clearCache)
                conn.send(.init(id: requestId, type: "reset.ok", payload: .object(["ok": .bool(true)])))

            default:
                sendError("unknown_type", "Unknown message type: \(envelope.type)")
            }
        } catch {
            sendError("bad_request", error.localizedDescription)
        }
    }

    private func requireString(_ payload: JSONValue?, key: String) throws -> String {
        guard let payload, case .object(let obj) = payload else {
            throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing payload"])
        }
        guard case .string(let s)? = obj[key] else {
            throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing string field '\(key)'"])
        }
        return s
    }

    private func optionalBool(_ payload: JSONValue?, key: String) throws -> Bool? {
        guard let payload, case .object(let obj) = payload else { return nil }
        guard let val = obj[key] else { return nil }
        if case .bool(let b) = val { return b }
        return nil
    }

    private func decodePayload<T: Decodable>(_ type: T.Type, from payload: JSONValue?) throws -> T {
        let data = try JSONEncoder().encode(payload ?? .null)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func encodePayload<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}


