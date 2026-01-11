// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "mlx-host",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "mlx-host", targets: ["MlxHost"])
    ],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", from: "0.29.1"),
        // LLM utilities + model implementations (used by MLX Swift examples)
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "MlxHost",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXFast", package: "mlx-swift"),
                .product(name: "MLXNN", package: "mlx-swift"),
                .product(name: "MLXRandom", package: "mlx-swift"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
            ]
        )
    ]
)


