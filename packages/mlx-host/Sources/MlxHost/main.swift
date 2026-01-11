import Foundation
import MLX

func getArg(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let idx = args.firstIndex(of: name), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

let socketPath = getArg("--socket")
    ?? ProcessInfo.processInfo.environment["MLX_HOST_SOCKET_PATH"]
    ?? "/tmp/mlx-host.sock"

let authToken = ProcessInfo.processInfo.environment["MLX_HOST_AUTH_TOKEN"]

// Optional device override:
// - gpu (default): fastest, requires Metal shaders (mlx.metallib / default.metallib)
// - cpu: works without metallib (slower)
let devicePref = (ProcessInfo.processInfo.environment["MLX_HOST_DEVICE"] ?? "gpu").lowercased()
let device: Device = (devicePref == "cpu") ? .cpu : .gpu
print("mlx-host device: \(devicePref == "cpu" ? "cpu" : "gpu")")

let server = MlxHostServer(socketPath: socketPath, authToken: authToken, engine: MLXSwiftEngine(device: device))

do {
    try server.start()
    print("mlx-host listening on \(socketPath)")
} catch {
    fputs("Failed to start server: \(error)\n", stderr)
    exit(1)
}

// Keep process alive.
dispatchMain()


