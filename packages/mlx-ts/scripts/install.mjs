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

// This package expects prebuilt assets (mlx-host + mlx.metallib) to be hosted somewhere
// (e.g. GitHub releases). To avoid broken installs, we only attempt the download when
// MLX_TS_HOST_BASE_URL is provided.
//
// Example:
//   export MLX_TS_HOST_BASE_URL="https://github.com/<you>/<repo>/releases/download/v0.1.0/darwin-arm64"
const BASE = process.env.MLX_TS_HOST_BASE_URL;
if (!BASE) {
  console.warn("[mlx-ts] MLX_TS_HOST_BASE_URL not set; skipping mlx-host download.");
  process.exit(0);
}

const BIN_DIR = path.resolve(new URL("../bin/darwin-arm64", import.meta.url).pathname);
fs.mkdirSync(BIN_DIR, { recursive: true });

const files = [
  { name: "mlx-host", url: `${BASE}/mlx-host` },
  { name: "mlx.metallib", url: `${BASE}/mlx.metallib` },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        }

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
    if (fs.existsSync(dest)) continue;
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

