import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { chmodSync } from "node:fs";

// This package is macOS Apple Silicon only (M1+).
if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.warn("[mlx-ts] skipping mlx-host install (supported only on darwin/arm64).");
  process.exit(0);
}

// Download source:
// - default: GitHub Releases for this repo
// - override: MLX_TS_HOST_BASE_URL
//
// Expected layout at BASE:
//   - mlx-host
//   - mlx.metallib
//
// Example override:
//   export MLX_TS_HOST_BASE_URL="https://github.com/kakaly/mlx-ts/releases/download/v0.1.1/darwin-arm64"
const pkgJsonPath = path.resolve(new URL("../package.json", import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
const VERSION = pkg.version;

// Note: GitHub release assets are served from a flat namespace (no subdirectories).
// We currently publish only darwin/arm64 assets as:
// - mlx-host
// - mlx.metallib
const DEFAULT_BASE = `https://github.com/kakaly/mlx-ts/releases/download/v${VERSION}`;
const BASE = process.env.MLX_TS_HOST_BASE_URL ?? DEFAULT_BASE;

const BIN_DIR = path.resolve(new URL("../bin/darwin-arm64", import.meta.url).pathname);
fs.mkdirSync(BIN_DIR, { recursive: true });

const files = [
  { name: "mlx-host", url: `${BASE}/mlx-host` },
  { name: "mlx.metallib", url: `${BASE}/mlx.metallib` },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          try {
            fs.unlinkSync(dest);
          } catch {}
          return reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {}
        reject(err);
      });
  });
}

async function main() {
  console.log(`[mlx-ts] installing mlx-host for ${process.platform}/${process.arch}`);
  console.log(`[mlx-ts] download base: ${BASE}`);
  console.log(`[mlx-ts] cache dir: ${os.tmpdir()}`);

  for (const f of files) {
    const dest = path.join(BIN_DIR, f.name);
    if (fs.existsSync(dest)) {
      try {
        const st = fs.statSync(dest);
        if (st.size > 0) continue;
        // A previous failed download can leave a 0-byte file; remove and retry.
        fs.unlinkSync(dest);
      } catch {}
    }
    console.log(`[mlx-ts] downloading ${f.name}...`);
    await download(f.url, dest);
  }

  // Ensure executable bit on the host binary.
  try {
    chmodSync(path.join(BIN_DIR, "mlx-host"), 0o755);
  } catch {}

  console.log("[mlx-ts] mlx-host installed.");
}

main().catch((err) => {
  console.error("[mlx-ts] install failed:", err);
  // Do not hard-fail installs by default; users can still supply MLX_HOST_BIN manually.
  process.exit(0);
});

