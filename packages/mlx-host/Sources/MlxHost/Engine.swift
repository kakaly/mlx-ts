import Foundation
import Hub
import MLX
import MLXLMCommon

protocol LLMEngine {
    func downloadModel(source: JSONValue?, modelsDir: String?) async throws -> (model: String, localPath: String)
    func loadModel(model: String) async throws
    func unloadModel(model: String) async throws
    func deleteModel(model: String) async throws
    func listModels() async -> (cached: [String], loaded: [String])

    func generate(requestId: String, request: GenerateRequest) async throws -> GenerateResponse
    func stream(requestId: String, request: GenerateRequest) async -> AsyncThrowingStream<String, Error>
    func cancel(requestId: String) async
    func reset(unloadAll: Bool, clearCache: Bool) async
}

actor MLXSwiftEngine: LLMEngine {
    private let device: Device
    private var cachedModels: [String: String] = [:] // model -> localPath
    private var containers: [String: ModelContainer] = [:] // model -> loaded container
    private var cancelled: Set<String> = []
    private var activeTasks: [String: Task<Void, Never>] = [:]
    private var lastDownloadLogTime: TimeInterval = 0
    private var lastDownloadCompleted: Int64 = -1
    private var lastDownloadTotal: Int64 = -1

    private func isCancelled(_ requestId: String) -> Bool {
        cancelled.contains(requestId)
    }
    
    private func clearCancelled(_ requestId: String) {
        cancelled.remove(requestId)
    }
    
    init(device: Device) {
        self.device = device
    }

    func downloadModel(source: JSONValue?, modelsDir: String?) async throws -> (model: String, localPath: String) {
        guard
            let source,
            case .object(let obj) = source,
            case .string(let kind)? = obj["kind"]
        else {
            throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid download source"])
        }

        switch kind {
        case "localPath":
            guard case .string(let path)? = obj["path"] else {
                throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing localPath.path"])
            }
            let modelId = "local:\(path)"
            cachedModels[modelId] = path
            return (modelId, path)
        case "huggingface":
            guard case .string(let repo)? = obj["repo"] else {
                throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing huggingface.repo"])
            }
            let revision: String = {
                if case .string(let r)? = obj["revision"] { return r }
                return "main"
            }()

            let baseURL: URL? = modelsDir.map { URL(fileURLWithPath: $0, isDirectory: true) }
            let hub = HubApi(downloadBase: baseURL)
            let repoObj = Hub.Repo(id: repo)

            // Keep download set small but sufficient for most MLX-community LLMs.
            let patterns = ["*.safetensors", "*.json", "tokenizer.*", "*.tiktoken", "*.model", "*.txt"]
            print("Downloading HF model \(repo) (rev \(revision)) to \(baseURL?.path ?? "(default cache)")")
            let dir = try await hub.snapshot(
                from: repoObj,
                revision: revision,
                matching: patterns,
                progressHandler: { progress in
                    // Throttle logs (Progress can be chatty). Note: this Progress typically advances
                    // when individual files complete (so it can appear "stuck" on large files).
                    let now = Date().timeIntervalSinceReferenceDate
                    if now - self.lastDownloadLogTime < 0.5 { return }
                    self.lastDownloadLogTime = now

                    let completed = progress.completedUnitCount
                    let total = progress.totalUnitCount

                    // Only print when something changes, otherwise it looks like a hang.
                    if completed != self.lastDownloadCompleted || total != self.lastDownloadTotal {
                        self.lastDownloadCompleted = completed
                        self.lastDownloadTotal = total
                        if total > 0 {
                            let pct = (Double(completed) / Double(total)) * 100.0
                            print(String(format: "Download progress: %.1f%% (%lld/%lld)", pct, completed, total))
                        } else {
                            print("Download progress: \(completed)")
                        }
                        return
                    }

                    // Heartbeat if a single large file is taking a long time.
                    if total > 0 {
                        print(String(format: "...still downloading (%lld/%lld)", completed, total))
                    } else {
                        print("...still downloading (\(completed))")
                    }
                }
            )

            let modelId = repo
            cachedModels[modelId] = dir.path
            return (modelId, dir.path)
        default:
            throw NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Unknown source.kind=\(kind)"])
        }
    }

    func loadModel(model: String) async throws {
        if containers[model] != nil { return }
        let t0 = Date()
        print("Loading model \(model) on \(device == .cpu ? "cpu" : "gpu")...")
        let container: ModelContainer = try await Device.withDefaultDevice(device) {
            try await Stream.withNewDefaultStream(device: device) {
                if let dirPath = cachedModels[model] {
                    return try await loadModelContainer(directory: URL(fileURLWithPath: dirPath, isDirectory: true))
                } else {
                    let hub = HubApi(downloadBase: nil)
                    return try await loadModelContainer(hub: hub, id: model, revision: "main")
                }
            }
        }
        containers[model] = container
        let dt = Date().timeIntervalSince(t0)
        print("Loaded model \(model) in \(String(format: "%.2f", dt))s")
    }

    func unloadModel(model: String) async throws {
        containers.removeValue(forKey: model)
    }

    func deleteModel(model: String) async throws {
        if let dir = cachedModels[model] {
            try? FileManager.default.removeItem(atPath: dir)
        }
        cachedModels.removeValue(forKey: model)
    }

    func listModels() async -> (cached: [String], loaded: [String]) {
        (Array(cachedModels.keys).sorted(), Array(containers.keys).sorted())
    }

    func generate(requestId: String, request: GenerateRequest) async throws -> GenerateResponse {
        let start = Date()
        let streamed = await stream(requestId: requestId, request: request)
        var out = ""
        var tokenCount = 0
        var ttft: TimeInterval?

        do {
            for try await chunk in streamed {
                if ttft == nil { ttft = Date().timeIntervalSince(start) }
                out += chunk
                tokenCount += 1
            }
        } catch {
            throw error
        }

        let total = Date().timeIntervalSince(start)
        let tps: Double? = total > 0 ? Double(tokenCount) / total : nil
        return GenerateResponse(
            requestId: requestId,
            text: out,
            usage: .init(promptTokens: nil, completionTokens: tokenCount, totalTokens: nil),
            timings: .init(ttftMs: (ttft ?? total) * 1000.0, totalMs: total * 1000.0, tokensPerSecond: tps)
        )
    }

    func stream(requestId: String, request: GenerateRequest) async -> AsyncThrowingStream<String, Error> {
        guard let container = containers[request.model] else {
            return AsyncThrowingStream { continuation in
                continuation.finish(throwing: NSError(domain: "mlx-host", code: 400, userInfo: [NSLocalizedDescriptionKey: "Model not loaded: \(request.model)"]))
            }
        }

        // Split history: everything except the last user message is history; last user is the prompt.
        let lastUserIdx = request.messages.lastIndex(where: { $0.role == .user })
        let prompt = lastUserIdx.map { request.messages[$0].content } ?? ""
        let history = request.messages.prefix(lastUserIdx ?? 0).map { msg -> Chat.Message in
            switch msg.role {
            case .system: return .system(msg.content)
            case .user: return .user(msg.content)
            case .assistant: return .assistant(msg.content)
            }
        }

        // Sampling
        var params = GenerateParameters()
        if let s = request.sampling {
            if let t = s.temperature { params.temperature = Float(t) }
            if let p = s.topP { params.topP = Float(p) }
            // GenerateParameters in MLXLMCommon currently doesn't expose topK/seed.
            if let r = s.repetitionPenalty { params.repetitionPenalty = Float(r) }
        }
        if let mt = request.maxTokens { params.maxTokens = mt }

        let session = ChatSession(container, history: history, generateParameters: params)

        return AsyncThrowingStream { continuation in
            let device = self.device
            let modelId = request.model
            let historyCount = history.count
            let promptPreview = String(prompt.prefix(120)).replacingOccurrences(of: "\n", with: "\\n")

            // Run generation off the actor executor to avoid starving the actor during long compute.
            let task = Task.detached { [weak self] in
                do {
                    let t0 = Date()
                    print("Starting stream \(requestId) model=\(modelId) history=\(historyCount) promptChars=\(prompt.count) maxTokens=\(request.maxTokens ?? -1)")
                    print("Prompt preview: \(promptPreview)")
                    var firstTokenLogged = false
                    
                    // Heartbeat so it's obvious we're not deadlocked.
                    let heartbeat = Task.detached {
                        while !Task.isCancelled && !firstTokenLogged {
                            try? await Task.sleep(nanoseconds: 5_000_000_000)
                            if !Task.isCancelled && !firstTokenLogged {
                                print("...waiting for first token (requestId=\(requestId))")
                            }
                        }
                    }
                    defer { heartbeat.cancel() }

                    try await Device.withDefaultDevice(device) {
                        try await Stream.withNewDefaultStream(device: device) {
                            let underlying = session.streamResponse(to: prompt)
                            for try await chunk in underlying {
                                if !firstTokenLogged {
                                    firstTokenLogged = true
                                    let ttft = Date().timeIntervalSince(t0)
                                    print("First token for \(requestId) after \(String(format: "%.2f", ttft))s")
                                }
                                if let self, await self.isCancelled(requestId) {
                                    continuation.finish(throwing: NSError(domain: "mlx-host", code: 499, userInfo: [NSLocalizedDescriptionKey: "Cancelled"]))
                                    await self.clearCancelled(requestId)
                                    return
                                }
                                continuation.yield(chunk)
                            }
                        }
                    }
                    let dt = Date().timeIntervalSince(t0)
                    print("Finished stream \(requestId) in \(String(format: "%.2f", dt))s")
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            activeTasks[requestId] = task
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    func cancel(requestId: String) async {
        cancelled.insert(requestId)
        activeTasks[requestId]?.cancel()
        activeTasks.removeValue(forKey: requestId)
    }

    func reset(unloadAll: Bool, clearCache: Bool) async {
        if unloadAll { containers.removeAll() }
        if clearCache {
            for (_, dir) in cachedModels {
                try? FileManager.default.removeItem(atPath: dir)
            }
            cachedModels.removeAll()
        }
        cancelled.removeAll()
        activeTasks.removeAll()
    }
}


