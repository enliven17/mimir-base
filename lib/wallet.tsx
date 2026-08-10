"use client";

/**
 * Wallet context — powered by wagmi v3 (no ConnectKit).
 *
 * Supports MetaMask, Coinbase Wallet, any EIP-6963 injected wallet, and
 * WalletConnect QR when NEXT_PUBLIC_WC_PROJECT_ID is set.
 *
 * connect() opens a small connector picker so the user chooses their wallet
 * instead of us guessing MetaMask.
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
import { botchainTestnet } from "./botchain";

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

function ConnectorPickerModal({
  open,
  onClose,
  connectors,
  isPending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  connectors: Array<{ id: string; name: string; connect: () => void }>;
  isPending: boolean;
  error: string | null;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-pv-border/40 bg-pv-bg p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-pv-text">Connect wallet</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-pv-muted hover:text-pv-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-pv-muted">
          BOT Chain Testnet (968). Pick a wallet to continue.
        </p>
        <div className="space-y-2">
          {connectors.length === 0 ? (
            <p className="text-sm text-pv-muted">No wallet connectors available.</p>
          ) : (
            connectors.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={isPending}
                onClick={() => c.connect()}
                className="flex w-full items-center justify-between rounded-xl border border-pv-border/40 bg-pv-surface2/60 px-4 py-3 text-left text-sm font-medium text-pv-text transition hover:border-pv-emerald/50 hover:bg-pv-surface2 disabled:opacity-50"
              >
                <span>{c.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-pv-muted">
                  {c.id}
                </span>
              </button>
            ))
          )}
        </div>
        {error && (
          <p className="mt-3 text-xs text-red-400">
            {error === "rejected" ? "Connection rejected in wallet." : "Could not connect. Try another wallet."}
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

  const isCorrectNetwork = !chain || chain.id === botchainTestnet.id;

  // Auto-switch the wallet to BOT Chain Testnet on connect.
  const autoSwitchAttempted = useRef(false);
  useEffect(() => {
    if (!isConnected || !chain) {
      autoSwitchAttempted.current = false;
      return;
    }
    if (chain.id === botchainTestnet.id) return;
    if (autoSwitchAttempted.current) return;
    autoSwitchAttempted.current = true;
    try {
      switchChain({ chainId: botchainTestnet.id });
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
    switchChain({ chainId: botchainTestnet.id });
  };

  const connectorList = useMemo(
    () =>
      connectors.map((c) => ({
        id: c.id,
        name: c.name,
        connect: () => {
          connect(
            { connector: c },
            {
              onSuccess: () => setPickerOpen(false),
            }
          );
        },
      })),
    [connectors, connect]
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
