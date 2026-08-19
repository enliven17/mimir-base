# AGENTS.md — Mimir

This repository contains Mimir, an AI-settled prediction market on **Base Sepolia**
(chain ID **84532**, CAIP-2 `eip155:84532`).

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/Mimir.sol` | Solidity smart contract (USDC escrow + payouts) |
| `lib/mimir-abi.ts` | ABI + state constants for Mimir.sol |
| `lib/base.ts` | Base Sepolia config (viem `baseSepolia`, RPC, explorer, log scans) |
| `lib/usdc.ts` | Official Base Sepolia USDC address, 6-decimal helpers, ERC-20 ABI |
| `lib/contract.ts` | TypeScript contract client (read + write, EIP-5792 batching) |
| `lib/wallet.tsx` | Wallet context (frontend, wagmi v3 connector picker) |
| `lib/wagmi-config.ts` | wagmi config — Base Sepolia only, Base Account first |
| `lib/agent-wallets.ts` | Local private-key wallets for oracle / creator / council |
| `lib/x402/config.ts` | Network, prices and Bazaar metadata for every paid endpoint |
| `lib/x402/server.ts` | x402 v2 seller paywall (`@x402/next`) + settlement recording |
| `lib/x402/buyer.ts` | x402 v2 buyer with a hard USDC budget cap (`@x402/fetch`) |
| `agents/oracle/index.ts` | Off-chain AI oracle agent (LLM + local key) |
| `agents/market-creator/index.ts` | Autonomous market creator (LLM + local key) |
| `agents/council/` | Ten AI personas that stake as economic actors |
| `lib/sibyl/` | HTTP client + load-bearing gates over Sibyl Memory |
| `sibyl/server.py` | Sidecar: real `sibyl_memory_client.MemoryClient` |
| `deploy/deploy.ts` | Base Sepolia deployment script (viem + solc) |
| `scripts/create-agent-wallets.ts` | Generate 12 EOAs (oracle + creator + 10 personas) |
| `scripts/fund-agents.ts` | Fund agent wallets from a master key |
| `scripts/check-forbidden-terms.mjs` | Guardrail: no pre-Base chain or bespoke-402 residue |

## Key rules

- Contract state is the source of truth. Neon Postgres is a read-index cache only.
- **Two assets, one job each.** Native **ETH** pays gas and nothing else. **USDC**
  (6 decimals, Circle's official Base Sepolia token) carries every value flow:
  market stakes, payouts, agent bankrolls and x402 payments.
- Stakes are ERC-20, so create/challenge/rematch need an **allowance** first.
  `lib/contract.ts` batches `approve` + the write into one confirmation when the
  wallet supports atomic EIP-5792 batching, and falls back to two transactions
  otherwise.
- Resolution is oracle-only. `resolveClaim()` can only be called by the `oracle`
  address set in the contract. Do not expose user-triggered resolution.
- Agents sign with **local private keys** held only in the worker process env
  (`ORACLE_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY`, `COUNCIL_<SLUG>_PRIVATE_KEY`).
  The web server never sees private keys — only public addresses for display and
  payment routing.
- Agent memory is **Sibyl Memory**, via `sibyl/server.py` and `lib/sibyl/`. No mock store. If the sidecar is down, challenge / create / stake refuse; settlement still runs. Full write-up: [`docs/SIBYL.md`](./SIBYL.md).
- Paid endpoints speak **x402 v2** only. Prices live in `lib/x402/config.ts` as
  dollar strings; the facilitator verifies and settles. Never reintroduce manual
  transaction inspection or custom payment headers.
- Money is accounted in **atomic integers**. `payments_v2.amount_atomic` is
  `NUMERIC(78,0)`; decimals are applied at the API/UI edge only.
- When `Mimir.sol` changes, keep `lib/mimir-abi.ts` and `lib/contract.ts` in sync
  and re-run `npm run compile:contract`.
- Categories: `sports`, `weather`, `crypto`, `culture`, `custom` (English).

## Oracle agent

```bash
# Start the oracle (needs ORACLE_PRIVATE_KEY + an LLM key)
npm run oracle
```

The oracle polls for active claims past their deadline, fetches evidence,
evaluates with an LLM, and sends `resolveClaim()` to the contract on Base Sepolia.

## Agents bootstrap

```bash
# 1. Generate all twelve wallets (writes keys + addresses into .env.local)
npm run agents:create-wallets

# 2. Fund from a master wallet (the faucet tops up the master only).
#    Each agent needs test USDC for stakes plus a little ETH for gas.
FUNDER_PRIVATE_KEY=0x... npm run agents:fund

# 3. Deploy contract
DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npm run deploy:contract

# 4. Run workers
npm run workers   # oracle + market-creator + council
```

Buying data over x402 needs **no** agent ETH: the `exact` scheme uses USDC
EIP-3009 authorizations, so agents only sign and the facilitator pays settlement
gas. ETH is required solely for the agents' own contract writes.

Faucet (Base Sepolia ETH + test USDC): https://portal.cdp.coinbase.com/products/faucet
Explorer: https://sepolia.basescan.org
Public RPC (local dev only, rate-limited): https://sepolia.base.org
