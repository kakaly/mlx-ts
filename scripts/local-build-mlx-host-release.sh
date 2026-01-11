#!/usr/bin/env bash
set -euo pipefail

# Local reproduction of `.github/workflows/release-mlx-host.yml` build steps.
# Requires: macOS + Xcode 16+ (Swift 6 toolchain available), Apple Silicon recommended.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT/packages/mlx-host"

echo "Repo: $ROOT"
echo "Package: $PKG_DIR"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "error: xcodebuild not found (install Xcode)." >&2
  exit 1
fi

echo "--- toolchain ---"
xcodebuild -version
swift --version || true

TMP="${TMPDIR:-/tmp}"
CLONED_SPM_DIR="$(mktemp -d "$TMP/mlx-ts-spm-checkouts.XXXXXX")"
RESULT_BUNDLE="$(mktemp -d "$TMP/mlx-host.xcresult.XXXXXX")"
LOG_FILE="$TMP/xcodebuild-mlx-host.local.log"
DERIVED_DATA="$(mktemp -d "$TMP/mlx-host-derived.XXXXXX")"

cleanup() {
  echo "--- cleanup ---"
  echo "Log: $LOG_FILE"
  echo "SPM checkouts: $CLONED_SPM_DIR"
  echo "DerivedData: $DERIVED_DATA"
  echo "Result bundle: $RESULT_BUNDLE"
}
trap cleanup EXIT

echo "--- resolve package deps ---"
(
  cd "$PKG_DIR"
  xcodebuild -resolvePackageDependencies \
    -scheme mlx-host \
    -destination 'platform=macOS' \
    -clonedSourcePackagesDirPath "$CLONED_SPM_DIR"
)

echo "--- patch mlx-swift-lm (Swift 5 compat) ---"
JAMBA="$CLONED_SPM_DIR/checkouts/mlx-swift-lm/Libraries/MLXLLM/Models/Jamba.swift"
if [ ! -f "$JAMBA" ]; then
  echo "error: expected file not found: $JAMBA" >&2
  echo "checkouts present:" >&2
  ls -la "$CLONED_SPM_DIR/checkouts" >&2 || true
  exit 1
fi

python3 - "$JAMBA" <<-'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines(True)

out: list[str] = []
changed = False
i = 0
n = len(lines)


def next_nonempty(idx: int) -> int:
    j = idx
    while j < n and lines[j].strip() == "":
        j += 1
    return j


while i < n:
    line = lines[i]
    if "bias: self.useConvBias," in line:
        j = next_nonempty(i + 1)
        if j < n and lines[j].lstrip().startswith(")"):
            out.append(line.replace("bias: self.useConvBias,", "bias: self.useConvBias"))
            changed = True
            i += 1
            continue
    out.append(line)
    i += 1

if not changed:
    print("error: Jamba.swift patch made no changes (pattern not found)")
    raise SystemExit(1)

path.write_text("".join(out))
print("patched Jamba.swift")
PY

echo "--- build (Debug) ---"
(
  cd "$PKG_DIR"
  : > "$LOG_FILE"
  set +e
  xcodebuild build \
    -scheme mlx-host \
    -destination 'platform=macOS' \
    -configuration Debug \
    ARCHS=arm64 \
    ONLY_ACTIVE_ARCH=NO \
    CODE_SIGNING_ALLOWED=NO \
    -clonedSourcePackagesDirPath "$CLONED_SPM_DIR" \
    -derivedDataPath "$DERIVED_DATA" \
    -resultBundlePath "$RESULT_BUNDLE" \
    | tee -a "$LOG_FILE"
  STATUS="${PIPESTATUS[0]}"
  set -e
  if [ "$STATUS" -ne 0 ]; then
    echo "--- first 'error:' line (if any) ---"
    grep -n "error:" "$LOG_FILE" | head -n 1 || true
    exit "$STATUS"
  fi
)

BIN="$DERIVED_DATA/Build/Products/Debug/mlx-host"
METAL="$DERIVED_DATA/Build/Products/Debug/mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib"

echo "--- outputs ---"
if [ -f "$BIN" ]; then
  echo "mlx-host: $BIN"
  ls -la "$BIN"
else
  echo "warning: mlx-host binary not found at $BIN"
fi

if [ -f "$METAL" ]; then
  echo "mlx.metallib (default.metallib): $METAL"
  ls -la "$METAL"
else
  echo "warning: default.metallib not found at $METAL"
fi

echo "OK"

