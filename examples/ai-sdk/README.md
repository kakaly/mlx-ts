## AI SDK example (local MLX model)

### 1) Build `mlx-host` with Metal shaders (recommended)

SwiftPM CLI builds can miss `default.metallib`. Build via `xcodebuild`:

```bash
cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/packages/mlx-host
xcodebuild build -scheme mlx-host -destination 'platform=macOS' -configuration Debug
```

Then point `MLX_HOST_BIN` at the DerivedData binary:

```bash
DD=$(ls -td ~/Library/Developer/Xcode/DerivedData/mlx-host-* | head -n 1)
export MLX_HOST_BIN="$DD/Build/Products/Debug/mlx-host"
```

### 2) Run the example

```bash
export MLX_HF_REPO="mlx-community/Llama-3.2-3B-Instruct-4bit"
export MLX_MODELS_DIR="/tmp/mlx-ts-models"

cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/examples/ai-sdk
npm install
npm run start
```

