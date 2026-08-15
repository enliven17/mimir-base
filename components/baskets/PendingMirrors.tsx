"use client";

/**
 * Positions from baskets you follow that you have not copied yet.
 *
 * One click each, signed by the follower. Mimir cannot place these for them: the
 * contract takes the stake from `msg.sender`, and Mimir holds no key for anyone
 * else. Doing it any other way would mean custody, which is exactly what following
 * a basket is designed to avoid.
 *
 * So the queue is the product, not a workaround — and it is the same input a
 * delegated executor would consume once sub-account signing is configured.
 */

import { useCallback, useEffect, useState } from "react";

import { useWallet } from "@/lib/wallet";
import { challengeClaim } from "@/lib/contract";

interface Mirror {
  basketId: string;
  basketName: string;
  claimId: number;
  question: string;
  agentId: string;
  agentName: string;
  memberStakeUsdc: number;
  mirrorUsdc: number;
  weightBps: number;
  deadline: number;
}

export function PendingMirrors() {
  const { address, isConnected } = useWallet();
  const [mirrors, setMirrors] = useState<Mirror[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/baskets/mirrors?subscriber=${address}`);
      const payload = await response.json();
      setMirrors(Array.isArray(payload.mirrors) ? payload.mirrors : []);
    } catch {
      setMirrors([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void load(); }, [load]);

  async function mirror(item: Mirror) {
    setBusyId(item.claimId);
    setError(null);
    try {
      const result = await challengeClaim(address!, item.claimId, item.mirrorUsdc);
      setDone((current) => ({ ...current, [item.claimId]: result.txHash ?? "sent" }));
      // Refresh rather than splice: the queue is derived from chain state, and the
      // authoritative answer to "is it still pending" is the server's.
      void load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/user rejected|denied/i.test(message) ? "Transaction rejected in your wallet." : message);
    } finally {
      setBusyId(null);
    }
  }

  if (!isConnected) return null;
  if (!loading && mirrors.length === 0) return null;

  return (
    <section className="border border-pv-emerald/35 bg-pv-emerald/[0.05] p-4">
      <div className="mb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-pv-emerald">
          Waiting to mirror
        </h3>
        <p className="text-[11px] text-pv-muted">
          Baskets you follow took these positions. Each one is a stake you sign — no
          funds are held on your behalf.
        </p>
      </div>

      {loading && mirrors.length === 0 && (
        <p className="py-3 text-[12px] text-pv-muted">Checking…</p>
      )}

      <ul className="space-y-2">
        {mirrors.map((item) => (
          <li key={`${item.basketId}-${item.claimId}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-pv-ink/[0.1] bg-pv-surface/50 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-pv-text">
                #{item.claimId} {item.question}
              </span>
              <span className="block font-mono text-[10px] text-pv-muted">
                {item.basketName} · {item.agentName} staked {item.memberStakeUsdc.toFixed(2)} · your weight {(item.weightBps / 100).toFixed(0)}%
              </span>
            </span>
            {done[item.claimId] ? (
              <span className="font-mono text-[11px] text-pv-emerald">mirrored ✓</span>
            ) : (
              <button
                type="button"
                onClick={() => mirror(item)}
                disabled={busyId !== null}
                className="btn-compact-primary shrink-0 px-3 py-1.5 text-[12px] disabled:opacity-40"
              >
                {busyId === item.claimId ? "Confirm in wallet…" : `Mirror ${item.mirrorUsdc.toFixed(2)} USDC`}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-[12px] text-pv-danger">{error}</p>}
    </section>
  );
}
