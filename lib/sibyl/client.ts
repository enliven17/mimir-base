/**
 * Talks to the Sibyl Memory sidecar. The sidecar is the only process that
 * imports sibyl_memory_client — this file never fakes a store.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class SibylUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SibylUnavailableError";
  }
}

export interface SibylEntity {
  id?: string;
  tenant_id?: string;
  category: string;
  name: string;
  status?: string | null;
  body: unknown;
  created_at?: string;
  updated_at?: string;
}

const DEFAULT_URL = process.env.SIBYL_MEMORY_URL ?? "http://127.0.0.1:8788";
const START_WAIT_MS = Number(process.env.SIBYL_START_WAIT_MS ?? "12000");

let started: ChildProcess | null = null;
let ready: Promise<void> | null = null;

function sidecarUrl(): string {
  return (process.env.SIBYL_MEMORY_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

export function sibylRequired(): boolean {
  return process.env.SIBYL_REQUIRED !== "0";
}

async function rpc<T>(body: Record<string, unknown>, timeoutMs = 8000): Promise<{ status: number; payload: T & { ok?: boolean; error?: string } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${sidecarUrl()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await res.json()) as T & { ok?: boolean; error?: string };
    return { status: res.status, payload };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SibylUnavailableError(`Sibyl sidecar unreachable: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sibylHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${sidecarUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; engine?: string };
    return body.ok === true && body.engine === "sibyl-memory-client";
  } catch {
    return false;
  }
}

function pythonCommands(): string[][] {
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "sibyl",
    "server.py",
  );
  const extra: string[][] = [];
  if (process.env.PYTHON) extra.push([process.env.PYTHON, script]);
  if (process.platform === "win32") {
    extra.push(["py", "-3", script], ["python", script], ["python3", script]);
  } else {
    extra.push(["python3", script], ["python", script]);
  }
  return extra;
}

function startSidecar(): ChildProcess {
  const env = {
    ...process.env,
    SIBYL_MEMORY_HOST: process.env.SIBYL_MEMORY_HOST ?? "127.0.0.1",
    SIBYL_MEMORY_PORT: process.env.SIBYL_MEMORY_PORT ?? "8788",
  };
  let lastErr: unknown;
  for (const [bin, ...args] of pythonCommands()) {
    try {
      const child = spawn(bin, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: false,
      });
      child.stdout?.on("data", (chunk) => {
        process.stderr.write(String(chunk));
      });
      child.stderr?.on("data", (chunk) => {
        process.stderr.write(String(chunk));
      });
      child.on("exit", (code, signal) => {
        if (started === child) started = null;
        if (code && code !== 0) {
          console.warn(`[sibyl] sidecar exited code=${code} signal=${signal ?? ""}`);
        }
      });
      return child;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new SibylUnavailableError(
    `Could not start Sibyl sidecar (tried py/python). ${lastErr instanceof Error ? lastErr.message : ""}`.trim(),
  );
}

export function stopSibyl(): void {
  if (started && !started.killed) {
    started.kill();
  }
  started = null;
  ready = null;
}

export async function ensureSibyl(): Promise<void> {
  if (await sibylHealthy()) return;
  if (!ready) {
    ready = (async () => {
      if (await sibylHealthy()) return;
      started = startSidecar();
      const deadline = Date.now() + START_WAIT_MS;
      while (Date.now() < deadline) {
        if (await sibylHealthy()) {
          started?.unref();
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new SibylUnavailableError(
        `Sibyl sidecar did not become healthy at ${sidecarUrl()} within ${START_WAIT_MS}ms. ` +
          `Install with: pip install -r sibyl/requirements.txt`,
      );
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}

export async function getEntity(
  tenant: string,
  category: string,
  name: string,
): Promise<SibylEntity | null> {
  await ensureSibyl();
  const { status, payload } = await rpc<{ entity?: SibylEntity }>({
    op: "get_entity",
    tenant,
    category,
    name,
  });
  if (status === 404 || payload.error === "not_found") return null;
  if (!payload.ok || !payload.entity) {
    throw new SibylUnavailableError(payload.error ?? "get_entity failed");
  }
  return payload.entity;
}

export async function setEntity(
  tenant: string,
  category: string,
  name: string,
  body: Record<string, unknown> | unknown[],
): Promise<SibylEntity> {
  await ensureSibyl();
  const { payload } = await rpc<{ entity?: SibylEntity }>({
    op: "set_entity",
    tenant,
    category,
    name,
    body,
  });
  if (!payload.ok || !payload.entity) {
    throw new SibylUnavailableError(payload.error ?? "set_entity failed");
  }
  return payload.entity;
}

export async function writeEvent(
  tenant: string,
  event: { evaluated?: unknown; acted?: unknown; extra?: unknown },
): Promise<string> {
  await ensureSibyl();
  const { payload } = await rpc<{ id?: string }>({
    op: "write_event",
    tenant,
    ...event,
  });
  if (!payload.ok || !payload.id) {
    throw new SibylUnavailableError(payload.error ?? "write_event failed");
  }
  return payload.id;
}

export async function readEvents(tenant: string, limit = 50): Promise<unknown[]> {
  await ensureSibyl();
  const { payload } = await rpc<{ events?: unknown[] }>({
    op: "read_events",
    tenant,
    limit,
  });
  if (!payload.ok) {
    throw new SibylUnavailableError(payload.error ?? "read_events failed");
  }
  return payload.events ?? [];
}
