"use client";

/**
 * Wallet context and connect modal — powered by wagmi v3.
 *
 * Supports Base Account, MetaMask, Coinbase Wallet, any EIP-6963 injected wallet,
 * and WalletConnect QR when NEXT_PUBLIC_WC_PROJECT_ID is set.
 *
 * Hand-rolled rather than ConnectKit/RainbowKit: both pin wagmi 2.x as a peer, and
 * dropping to wagmi 2 would cost the `baseAccount` connector — the only one that can
 * batch approve(USDC) + createClaim into a single confirmation (EIP-5792). The
 * ordering and dedupe rules live in lib/wallet-connectors.ts so they stay testable.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { baseSepolia } from "./base";
import {
  labelFor,
  shapeConnectors,
  subtitleFor,
  type ShapedConnector,
} from "./wallet-connectors";

/** Remembering the last wallet turns a 5-row decision into one tap on return. */
const RECENT_CONNECTOR_KEY = "mimir-recent-connector";

function readRecentConnector(): string | null {
  try {
    return window.localStorage.getItem(RECENT_CONNECTOR_KEY);
  } catch {
    return null;
  }
}

function rememberConnector(id: string): void {
  try {
    window.localStorage.setItem(RECENT_CONNECTOR_KEY, id);
  } catch {
    /* private mode — the modal simply won't show a "recent" hint next time */
  }
}

interface WalletCtx {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isCorrectNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  error: string | null;
  /** Available connectors (MetaMask, Coinbase, etc.) */
  connectors: Array<{ id: string; name: string; connect: () => void }>;
}

const Ctx = createContext<WalletCtx>({
  address: null,
  isConnected: false,
  isConnecting: false,
  isCorrectNetwork: true,
  connect: async () => {},
  disconnect: () => {},
  switchNetwork: async () => {},
  error: null,
  connectors: [],
});

type ModalConnector = ShapedConnector & { connect: () => void };

/** Brand mark from the connector, or its initial when the wallet ships none. */
function ConnectorMark({ connector }: { connector: ModalConnector }) {
  if (connector.icon) {
    return (
      // Wallet-supplied data URI; next/image would only add a loader in front of it.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={connector.icon} alt="" aria-hidden className="h-7 w-7 shrink-0 rounded-md" />
    );
  }
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-pv-ink/[0.14] font-mono text-[12px] font-bold text-pv-muted"
    >
      {connector.monogram}
    </span>
  );
}

function ConnectorRow({
  connector,
  isPending,
  featured,
}: {
  connector: ModalConnector;
  isPending: boolean;
  featured: boolean;
}) {
  const subtitle = subtitleFor(connector);
  const badge = connector.recent ? "RECENT" : connector.detected ? "DETECTED" : null;

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={connector.connect}
      className={`flex w-full items-center gap-3 border px-4 py-3 text-left transition-colors duration-150 disabled:opacity-50 ${
        featured
          ? "border-pv-emerald/45 bg-pv-emerald/[0.08] hover:border-pv-emerald hover:bg-pv-emerald/[0.14]"
          : "border-pv-ink/[0.12] bg-pv-surface2/60 hover:border-pv-emerald/50 hover:bg-pv-surface2"
      }`}
    >
      <ConnectorMark connector={connector} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-pv-text">{labelFor(connector)}</span>
          {featured && (
            <span className="shrink-0 border border-pv-emerald/40 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-pv-emerald">
              one-tap
            </span>
          )}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[11px] text-pv-muted">{subtitle}</span>
        )}
      </span>
      {badge && (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-pv-muted">
          {badge}
        </span>
      )}
    </button>
  );
}

function ConnectorPickerModal({
  open,
  onClose,
  connectors,
  isPending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  connectors: ModalConnector[];
  isPending: boolean;
  error: string | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes: a modal that can only be dismissed by clicking the backdrop
  // traps anyone on a keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const [featured, ...rest] = connectors;
  const isFeatured = featured?.kind === "baseAccount";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Connect wallet"
        className="w-full max-w-sm border border-pv-border/40 bg-pv-bg p-5 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-pv-text">Connect wallet</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-sm text-pv-muted transition-colors hover:text-pv-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 font-mono text-[11px] uppercase tracking-wider text-pv-muted">
          Base Sepolia · 84532
        </p>

        {connectors.length === 0 ? (
          <p className="text-sm text-pv-muted">
            No wallet detected. Install MetaMask or Coinbase Wallet, or open this page in
            a wallet browser.
          </p>
        ) : (
          <div className="space-y-2">
            {featured && (
              <ConnectorRow connector={featured} isPending={isPending} featured={isFeatured} />
            )}
            {isFeatured && rest.length > 0 && (
              <div className="flex items-center gap-3 py-1" aria-hidden>
                <span className="h-px flex-1 bg-pv-ink/[0.12]" />
                <span className="font-mono text-[9px] uppercase tracking-wider text-pv-muted">
                  or
                </span>
                <span className="h-px flex-1 bg-pv-ink/[0.12]" />
              </div>
            )}
            {rest.map((c) => (
              <ConnectorRow key={c.id} connector={c} isPending={isPending} featured={false} />
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-pv-danger">
            {error === "rejected"
              ? "Connection rejected in wallet."
              : "Could not connect. Try another wallet."}
          </p>
        )}
      </div>
    </div>
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error: connectError, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [pickerOpen, setPickerOpen] = useState(false);

  const isCorrectNetwork = !chain || chain.id === baseSepolia.id;

  // Auto-switch the wallet to Base Sepolia on connect.
  const autoSwitchAttempted = useRef(false);
  useEffect(() => {
    if (!isConnected || !chain) {
      autoSwitchAttempted.current = false;
      return;
    }
    if (chain.id === baseSepolia.id) return;
    if (autoSwitchAttempted.current) return;
    autoSwitchAttempted.current = true;
    try {
      switchChain({ chainId: baseSepolia.id });
    } catch {
      /* user rejected */
    }
  }, [isConnected, chain, switchChain]);

  // Close picker once connected.
  useEffect(() => {
    if (isConnected) setPickerOpen(false);
  }, [isConnected]);

  const openPicker = useCallback(async () => {
    reset();
    setPickerOpen(true);
  }, [reset]);

  const switchNetwork = async () => {
    switchChain({ chainId: baseSepolia.id });
  };

  // Read once the picker opens rather than at render: localStorage is unavailable
  // during SSR, and reading it in the render body would hydrate-mismatch.
  const [recentId, setRecentId] = useState<string | null>(null);
  useEffect(() => {
    if (pickerOpen) setRecentId(readRecentConnector());
  }, [pickerOpen]);

  const connectorList = useMemo<ModalConnector[]>(
    () =>
      shapeConnectors(
        connectors.map((c) => ({ id: c.id, name: c.name, icon: c.icon, type: c.type })),
        { recentId },
      ).map((shaped) => {
        const connector = connectors.find((c) => c.id === shaped.id);
        return {
          ...shaped,
          connect: () => {
            if (!connector) return;
            connect(
              { connector },
              {
                onSuccess: () => {
                  rememberConnector(connector.id);
                  setPickerOpen(false);
                },
              },
            );
          },
        };
      }),
    [connectors, connect, recentId],
  );

  const error = connectError
    ? connectError.message.toLowerCase().includes("reject")
      ? "rejected"
      : "error"
    : null;

  return (
    <Ctx.Provider
      value={{
        address: address ?? null,
        isConnected,
        isConnecting: isPending,
        isCorrectNetwork,
        connect: openPicker,
        disconnect,
        switchNetwork,
        error,
        connectors: connectorList,
      }}
    >
      {children}
      <ConnectorPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        connectors={connectorList}
        isPending={isPending}
        error={error}
      />
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}
