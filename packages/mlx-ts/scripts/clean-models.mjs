#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function defaultModelsDir() {
  const home = os.homedir() || os.tmpdir();

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "mlx-ts", "models");
  }

  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return path.join(base, "mlx-ts", "models");
  }

  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.trim()) return path.join(xdg, "mlx-ts", "models");
  return path.join(home, ".cache", "mlx-ts", "models");
}

function legacyTempModelsDir() {
  return path.join(os.tmpdir(), "mlx-ts-models");
}

function parseArgs(argv) {
  const out = { yes: false, dryRun: false, dir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`Unknown arg: ${a}`);
      out.help = true;
    }
  }
  return out;
}

function usage() {
  console.log(`mlx-ts-clean-models

Deletes cached model downloads for mlx-ts.

Usage:
  mlx-ts-clean-models --yes [--dry-run]
  mlx-ts-clean-models --dir /some/path --yes [--dry-run]

Notes:
  - Without --dir, deletes BOTH:
    - default OS cache dir (current mlx-ts default)
    - legacy temp dir (older versions)
  - Set MLX_MODELS_DIR to control where models are cached.
`);
}

function isDangerousDir(p) {
  const n = path.resolve(p);
  const home = os.homedir() ? path.resolve(os.homedir()) : "";
  return (
    n === path.parse(n).root ||
    n === home ||
    n === path.resolve(os.tmpdir()) ||
    n.length < 10
  );
}

function rmDir(dir, dryRun) {
  const resolved = path.resolve(dir);
  if (isDangerousDir(resolved)) {
    throw new Error(`Refusing to delete suspicious path: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    console.log(`[skip] missing: ${resolved}`);
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] would delete: ${resolved}`);
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  console.log(`[deleted] ${resolved}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.yes) {
    console.error("Refusing to delete without --yes");
    usage();
    process.exit(2);
  }

  const targets = [];
  if (args.dir) {
    targets.push(args.dir);
  } else {
    targets.push(defaultModelsDir(), legacyTempModelsDir());
  }

  console.log("mlx-ts model cache cleanup");
  console.log(`platform=${process.platform} arch=${process.arch}`);
  if (process.env.MLX_MODELS_DIR) {
    console.log(`MLX_MODELS_DIR=${process.env.MLX_MODELS_DIR}`);
  }
  if (args.dryRun) console.log("(dry-run)");

  for (const t of targets) rmDir(t, args.dryRun);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
