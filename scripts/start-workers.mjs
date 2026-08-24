/**
 * Railway entrypoint: install/verify real Sibyl Memory, start the sidecar,
 * then boot the agent workers. Workers refuse to stake if this sidecar is down.
 *
 * Nixpacks Python is PEP 668 locked (no system pip). Install into a venv on
 * the persistent volume so the official sibyl-memory-client wheel is what runs.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.SIBYL_MEMORY_DB ?? "/data/sibyl/memory.db";
const venvDir = process.env.SIBYL_VENV ?? path.join(path.dirname(dbPath), "venv");
const host = process.env.SIBYL_MEMORY_HOST ?? "127.0.0.1";
const port = process.env.SIBYL_MEMORY_PORT ?? "8788";
const healthUrl = `http://${host}:${port}/health`;
const waitMs = Number(process.env.SIBYL_START_WAIT_MS ?? "20000");

function mustOk(result, label) {
  if (result.error) {
    console.error(`[sibyl] ${label}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[sibyl] ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function canImport(python) {
  const result = spawnSync(python, ["-c", "from sibyl_memory_client import MemoryClient"], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function systemPython() {
  for (const bin of [process.env.PYTHON, "python3", "python"].filter(Boolean)) {
    const result = spawnSync(bin, ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
    });
    if (result.status === 0 && !result.error) return bin;
  }
  console.error("[sibyl] no system python3 found");
  process.exit(1);
}

function venvPython() {
  const unix = path.join(venvDir, "bin", "python");
  const win = path.join(venvDir, "Scripts", "python.exe");
  if (fs.existsSync(unix)) return unix;
  if (fs.existsSync(win)) return win;
  return unix;
}

function ensureClient() {
  const py = venvPython();
  if (canImport(py)) return py;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const base = systemPython();
  console.log(`[sibyl] creating venv at ${venvDir} with ${base}`);
  mustOk(
    spawnSync(base, ["-m", "venv", "--without-pip", venvDir], { stdio: "inherit", encoding: "utf8" }),
    "venv",
  );

  const venvPy = venvPython();
  console.log("[sibyl] bootstrapping pip into venv");
  mustOk(
    spawnSync(
      venvPy,
      ["-c", "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')"],
      { stdio: "inherit", encoding: "utf8" },
    ),
    "download get-pip.py",
  );
  mustOk(
    spawnSync(venvPy, ["/tmp/get-pip.py"], { stdio: "inherit", encoding: "utf8" }),
    "get-pip.py",
  );
  console.log("[sibyl] installing sibyl-memory-client");
  mustOk(
    spawnSync(venvPy, ["-m", "pip", "install", "-r", "sibyl/requirements.txt"], {
      stdio: "inherit",
      encoding: "utf8",
    }),
    "pip install sibyl-memory-client",
  );
  if (!canImport(venvPy)) {
    console.error("[sibyl] import still failing after venv install");
    process.exit(1);
  }
  return venvPy;
}

async function waitHealthy() {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const body = await res.json();
        if (body?.ok && body.engine === "sibyl-memory-client") return;
      }
    } catch {
      // sidecar still binding
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Sibyl sidecar not healthy at ${healthUrl} after ${waitMs}ms`);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const python = ensureClient();
process.env.PYTHON = python;
console.log(`[sibyl] starting sidecar with ${python} db=${dbPath}`);

const sidecar = spawn(
  python,
  ["sibyl/server.py"],
  {
    env: {
      ...process.env,
      SIBYL_MEMORY_DB: dbPath,
      SIBYL_MEMORY_HOST: host,
      SIBYL_MEMORY_PORT: port,
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
sidecar.on("exit", (code, signal) => {
  console.error(`[sibyl] sidecar exited code=${code} signal=${signal ?? ""}`);
  process.exit(code ?? 1);
});

try {
  await waitHealthy();
} catch (err) {
  console.error("[sibyl]", err instanceof Error ? err.message : err);
  sidecar.kill();
  process.exit(1);
}
console.log("[sibyl] sidecar healthy — starting workers");

// ponytail: one Node process for every worker (see agents/all.ts). Heap is
// capped so GC pressures before the container OOM-killer does; raise
// WORKERS_MAX_OLD_SPACE_MB if Railway gives the service more memory.
const heapMb = process.env.WORKERS_MAX_OLD_SPACE_MB ?? "384";
const workers = spawn(
  process.execPath,
  [`--max-old-space-size=${heapMb}`, "--import", "tsx", "agents/all.ts"],
  { stdio: "inherit", env: { ...process.env, PYTHON: python } },
);
if (process.env.VIRTUALS_ACP_ENABLED === "1") console.log("[virtuals-acp] worker enabled");

const shutdown = (signal) => {
  workers.kill(signal);
  sidecar.kill(signal);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
workers.on("exit", (code) => {
  sidecar.kill();
  process.exit(code ?? 1);
});
