"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wagmi-config";

const queryClient = new QueryClient();

/**
 * App-level wallet providers. ConnectKit was removed — it only peers with
 * wagmi v2 and broke install/build against wagmi v3. Connect UX lives in
 * lib/wallet.tsx (connector picker modal).
 */
export function WagmiProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
