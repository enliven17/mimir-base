"use client";

/**
 * One-tap mirroring through a Base Account sub account.
 *
 * ── Why a sub account, and why the key lives in the browser ──────────────────
 *
 * The contract takes a stake from `msg.sender`, so something the user owns has to
 * send the transaction. A sub account IS user-owned — their Base Account controls
 * it, and they can revoke it — while the app holds a scoped signer for it. That
 * makes `msg.sender` the user's own address, so payouts and attribution land with
 * them, and Mimir still holds nothing it could run away with.
 *
 * The signer is a P256 key in browser storage, deliberately NOT on our servers.
 * A server-held key would let mirrors fire while the user is away, and would also
 * mean Mimir could spend their budget unattended — which is the custody their own
 * ADR-0008 rules out. So mirrors fire while a tab is open; the pending-mirror
 * queue covers the rest, and the user signs those when they return.
 *
 * No bundler is configured anywhere here: the SDK submits through the wallet's
 * own infrastructure and takes a paymaster only as an optional gas sponsor.
 */

import { baseSepolia } from "./base";

/** Loaded on demand: the SDK is large and only matters once someone opts in. */
async function loadSdk() {
  const [{ createBaseAccountSDK }, { getCryptoKeyAccount }] = await Promise.all([
    import("@base-org/account"),
    import("@base-org/account"),
  ]);
  return { createBaseAccountSDK, getCryptoKeyAccount };
}

const STORAGE_KEY = "mimir-sub-account";

export interface SubAccountState {
  address: `0x${string}`;
  /** The Base Account that owns it, for display and for revocation. */
  ownerAddress?: `0x${string}`;
}

export function readSubAccount(): SubAccountState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SubAccountState) : null;
  } catch {
    return null;
  }
}

function rememberSubAccount(state: SubAccountState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the sub account still works for this session */
  }
}

export function forgetSubAccount(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}

function paymasterUrls(): Record<number, string> | undefined {
  const url = process.env.NEXT_PUBLIC_PAYMASTER_URL?.trim();
  return url ? { [baseSepolia.id]: url } : undefined;
}

async function provider() {
  const { createBaseAccountSDK, getCryptoKeyAccount } = await loadSdk();
  const sdk = createBaseAccountSDK({
    appName: "Mimir",
    appLogoUrl: "/icon.svg",
    appChainIds: [baseSepolia.id],
    paymasterUrls: paymasterUrls(),
    subAccounts: {
      creation: "manual",
      defaultAccount: "sub",
      // Funded from the universal account through the spend permission the user
      // signs during setup, rather than asking them to transfer USDC first.
      funding: "spend-permissions",
      toOwnerAccount: getCryptoKeyAccount,
    },
  });
  return sdk.getProvider();
}

/**
 * Create the sub account, or return the one already set up.
 *
 * Idempotent: `wallet_addSubAccount` returns the existing account when the app's
 * signer already has one, so a second call after a cleared localStorage recovers
 * rather than creating a duplicate the user would have to fund again.
 */
export async function enableOneTapMirroring(): Promise<SubAccountState> {
  const { getCryptoKeyAccount } = await loadSdk();
  const eip1193 = await provider();

  const accounts = (await eip1193.request({ method: "eth_requestAccounts" })) as string[];
  const owner = accounts?.[0] as `0x${string}` | undefined;

  const { account } = await getCryptoKeyAccount();
  if (!account) throw new Error("could not create a signing key in this browser");

  const response = (await eip1193.request({
    method: "wallet_addSubAccount",
    params: [{
      version: "1",
      account: {
        type: "create",
        keys: [{ type: "webcrypto-p256", publicKey: account.publicKey as `0x${string}` }],
      },
    }],
  })) as { address: `0x${string}` };

  const state: SubAccountState = { address: response.address, ownerAddress: owner };
  rememberSubAccount(state);
  return state;
}

export interface SubAccountCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: `0x${string}`;
}

/**
 * Send calls from the sub account without a per-transaction prompt.
 *
 * Returns the ERC-5792 bundle id rather than a transaction hash: the wallet may
 * batch, and reporting a hash it has not produced yet would be a lie the UI then
 * has to walk back.
 */
export async function sendFromSubAccount(calls: SubAccountCall[]): Promise<string> {
  const state = readSubAccount();
  if (!state) throw new Error("one-tap mirroring is not enabled in this browser");

  const eip1193 = await provider();
  const result = (await eip1193.request({
    method: "wallet_sendCalls",
    params: [{
      version: "1.0",
      chainId: `0x${baseSepolia.id.toString(16)}`,
      from: state.address,
      calls: calls.map((call) => ({ ...call, value: call.value ?? "0x0" })),
      capabilities: paymasterUrls()
        ? { paymasterService: { url: paymasterUrls()![baseSepolia.id] } }
        : undefined,
    }],
  })) as string | { id?: string };

  return typeof result === "string" ? result : (result?.id ?? "sent");
}
