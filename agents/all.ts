/**
 * Single-process entrypoint for every Mimir worker.
 *
 * ponytail: was `concurrently` running 5 separate `tsx` processes — 5 Node
 * heaps + 5 esbuild services + 5 npm shells OOM-killed the Railway container.
 * Every agent module self-starts its own setInterval poller at import time, so
 * importing them here is starting them, and they share one heap.
 */
import "./sync/index";
import "./oracle/index";
import "./market-creator/index";
import "./council/index";
import "./traders/index";

// Opt-in seller. Dynamic so the ACP SDK is never loaded when it's off.
if (process.env.VIRTUALS_ACP_ENABLED === "1") {
  void import("./virtuals/acp-seller");
}
