# AGENTS.md — Mimir

This repository contains Mimir, an AI-settled prediction market on **BOT Chain** (EVM L1, chain ID **968**).

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/Mimir.sol` | Solidity smart contract (EVM, BOT Chain Testnet) |
| `lib/mimir-abi.ts` | ABI + state constants for Mimir.sol |
| `lib/base.ts` | BOT Chain config (viem, chain ID 968, BOT helpers) |
| `lib/contract.ts` | TypeScript contract client (read + write) |
| `lib/wallet.tsx` | Wallet context (frontend, wagmi v3 connector picker) |
| `lib/wagmi-config.ts` | wagmi config — BOT Chain Testnet only |
| `lib/agent-wallets.ts` | Local private-key wallets for oracle / creator / council |
| `lib/paid-client.ts` / `lib/paid-server.ts` | HTTP 402 native-BOT micropayments between agents |
| `agents/oracle/index.ts` | Off-chain AI oracle agent (LLM + local key) |
| `agents/market-creator/index.ts` | Autonomous market creator (LLM + local key) |
| `agents/council/` | Ten AI personas that stake as economic actors |
| `deploy/deploy.ts` | BOT Chain deployment script (viem) |
| `scripts/create-agent-wallets.ts` | Generate 12 EOAs (oracle + creator + 10 personas) |
| `scripts/fund-agents.ts` | Fund agent wallets from a master key |

## Key rules

- Contract state is the source of truth. Neon Postgres is a read-index cache only.
- **BOT** is the native currency on BOT Chain (18 decimals, like ETH). Stakes use `msg.value` — no ERC-20 approval needed.
- Resolution is oracle-only. `resolveClaim()` can only be called by the `oracle` address set in the contract. Do not expose user-triggered resolution.
- Agents sign with **local private keys** held only in the worker process env (`ORACLE_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY`, `COUNCIL_<SLUG>_PRIVATE_KEY`). The web server never sees private keys — only public addresses for display and payment routing.
- When `Mimir.sol` changes, keep `lib/mimir-abi.ts` and `lib/contract.ts` in sync.
- Categories: `sports`, `weather`, `crypto`, `culture`, `custom` (English).

## Oracle agent

```bash
# Start the oracle (needs ORACLE_PRIVATE_KEY + an LLM key)
npm run oracle
```

The oracle polls for active claims past their deadline, fetches evidence, evaluates with an LLM, and sends `resolveClaim()` to BOT Chain.

## Agents bootstrap

```bash
# 1. Generate all twelve wallets (writes keys + addresses into .env.local)
npm run agents:create-wallets

# 2. Fund from a master wallet (faucet tops up the master only)
FUNDER_PRIVATE_KEY=0x... npm run agents:fund

# 3. Deploy contract
DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npm run deploy:contract

# 4. Run workers
npm run workers   # oracle + market-creator + council
```

Testnet BOT faucet: https://faucet.botchain.ai/basic  
Explorer: https://scan.bohr.life  
RPC: https://rpc.bohr.life  
