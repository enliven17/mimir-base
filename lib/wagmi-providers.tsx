"use client";

/**
 * App-level wallet providers.
 *
 * Two ways in, deliberately: **Privy** for anyone who does not already hold a
 * wallet (email or social, with an embedded wallet created for them), and **Base
 * Account** for anyone who does — the only connector that can batch approve(USDC)
 * and the stake into a single confirmation.
 *
 * Privy drives wagmi through its own WagmiProvider, so `useAccount`, `useConnect`
 * and every existing hook keep working whichever door the user came through.
 *
 * ConnectKit and RainbowKit both peer with wagmi 2.x and would have forced a
 * downgrade that costs the Base Account connector. Privy peers with wagmi >=2 and
 * pins the exact viem this repo already runs, which is why it is here at all.
 */

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { baseSepolia } from "./base";
import { wagmiConfig } from "./wagmi-config";

const queryClient = new QueryClient();

/** Unset in local checkouts and previews; the app must still boot without Privy. */
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

export function isPrivyConfigured(): boolean {
  return Boolean(PRIVY_APP_ID);
}

export function WagmiProviders({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    // No app id: fall back to plain wagmi rather than rendering a provider that
    // throws on mount. The connect modal hides the Privy option to match.
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Base Sepolia only. Offering chains the contract is not on invites a user
        // to fund a wallet on a network where nothing here works.
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
        loginMethods: ["email", "google", "farcaster", "wallet"],
        embeddedWallets: {
          // Only for users who arrive without one: creating a second wallet for
          // someone who just connected MetaMask splits their funds in two.
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        appearance: {
          theme: "dark",
          accentColor: "#334FA9",
          logo: "/icon.svg",
          walletList: ["metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
