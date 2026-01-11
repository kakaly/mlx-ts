## AI SDK example (local MLX model)

### Run the example

```bash
export MLX_HF_REPO="mlx-community/Llama-3.2-3B-Instruct-4bit"
export MLX_MODELS_DIR="/tmp/mlx-ts-models"

cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/examples/ai-sdk
npm install
npm run start
```

### Dev note (only if you’re hacking on `mlx-host`)

If you want to build the Swift host yourself (instead of using the prebuilt binary downloaded during `npm install`), build via `xcodebuild` (this produces `default.metallib`):

```bash
cd /Users/karthikkalyanaraman/personal-projects/mlx-ts/packages/mlx-host
xcodebuild build -scheme mlx-host -destination 'platform=macOS' -configuration Debug

DD=$(ls -td ~/Library/Developer/Xcode/DerivedData/mlx-host-* | head -n 1)
export MLX_HOST_BIN="$DD/Build/Products/Debug/mlx-host"
```

