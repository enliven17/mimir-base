# Mimir — Full Project Context for AI Agent

You are being onboarded to the Mimir codebase. This document is **self-contained** — it includes architecture, stack, and implementation status so you can work on this project efficiently.

---

## What is Mimir?

Mimir is an **AI-settled prediction market** built on **Base Sepolia** (Chain ID **84532**, CAIP-2 `eip155:84532`). Users create verifiable claims about real-world outcomes (sports, crypto, weather, culture), stake **USDC**, and share a link for opponents to challenge. When the deadline arrives, the Mimir oracle agent:

1. Fetches live evidence from the web (claim's `resolutionUrl`)
2. Evaluates the evidence via an LLM (Gemini preferred, Anthropic / Groq / OpenRouter fallbacks)
3. Sends a `resolveClaim()` transaction to Base with the verdict
4. The winner is paid automatically in USDC — no committees, no disputes

**One-liner:** "An AI-settled claim market supporting head-to-head, 1-v-many, pool-odds, fixed-odds, and rivalry-linked rematches — settled in USDC on Base."

**License:** AGPL-3.0-or-later  
**Default locale:** English (en)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 18, TypeScript 5 |
| Styling | Tailwind CSS 3.4, Framer Motion 12 |
| Blockchain | Base Sepolia (Chain ID 84532), viem 2.55, wagmi 3 |
| Smart Contract | Solidity — `contracts/Mimir.sol` |
| AI Oracle | `agents/oracle/index.ts` (off-chain, local private key) |
| Council | 10 AI personas — `agents/council/` (local keys) |
| Payments | x402 v2 in USDC (`lib/x402/*`, `@x402/next` + `@x402/fetch`) |
| Messaging | XMTP Browser SDK v7 (encrypted peer-to-peer chat) |
| i18n | next-intl (English default) |
| Auth | wagmi v3 connector picker (Base Account, MetaMask, Coinbase, WC, injected) |
| Database | Neon Postgres (optional read-index cache) |
| Deployment | Vercel (frontend), Railway (workers), viem deploy (contract) |

---

## Project Structure (key paths)

```
mimir-base/
├── app/                        # Next.js App Router
│   ├── [locale]/               # i18n routes (home, explorer, vs, dashboard, council, …)
│   └── api/                    # Route handlers (vs, council, oracle, payments, cron)
├── agents/
│   ├── oracle/                 # Settler + optional auto-challenge
│   ├── market-creator/         # Autonomous market creation
│   └── council/                # 10 personas
├── components/                 # UI
├── contracts/Mimir.sol
├── deploy/deploy.ts            # Base Sepolia deploy (viem + solc)
├── lib/
│   ├── base.ts                 # baseSepolia, RPC, explorer, paginated getLogs
│   ├── usdc.ts                 # Official Base Sepolia USDC, 6dp helpers
│   ├── mimir-abi.ts
│   ├── contract.ts
│   ├── agent-wallets.ts        # Local key wallets for workers
│   ├── x402/                   # config.ts (prices) / server.ts / buyer.ts
│   ├── paid-revenue.ts         # atomic USDC ledger
│   ├── wallet.tsx / wagmi-config.ts
│   └── xmtp/
├── scripts/                    # create/fund wallets, seed claims, demo cycle
└── tests/node/                 # Smoke tests
```

---

## Environment Variables

**Public (browser-exposed):**
```
NEXT_PUBLIC_CONTRACT_ADDRESS        # Deployed Mimir.sol on Base Sepolia
NEXT_PUBLIC_DEPLOY_BLOCK            # Deploy block for log scans
NEXT_PUBLIC_BASE_RPC_URL            # RPC — REQUIRED in deployed envs (public one is rate-limited)
NEXT_PUBLIC_USDC_ADDRESS            # Override only for a local fork
NEXT_PUBLIC_DEMO_MODE               # "1" to enable demo relay
NEXT_PUBLIC_WC_PROJECT_ID           # WalletConnect Cloud project id
NEXT_PUBLIC_FEATURE_XMTP            # Enable XMTP UI
NEXT_PUBLIC_XMTP_ENV                # local | dev | production
```

**Server / workers only:**
```
BASE_RPC_URL                        # Server-side RPC override
ORACLE_PRIVATE_KEY                  # Oracle agent
CREATOR_PRIVATE_KEY                 # Market-creator agent
COUNCIL_<SLUG>_PRIVATE_KEY          # Each council persona (workers)
COUNCIL_<SLUG>_ADDRESS              # Public addresses (web-safe)
SELLER_ADDRESS                      # Default x402 payTo for paid endpoints
X402_NETWORK                        # CAIP-2 id (default eip155:84532)
X402_FACILITATOR_URL                # Default https://x402.org/facilitator
CDP_API_KEY_ID / CDP_API_KEY_SECRET # CDP facilitator auth (never NEXT_PUBLIC_)
DATABASE_URL                        # Neon pooler URL (optional)
GEMINI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY
```

See `.env.example` for the full list (`*_USDC` budget knobs, council settlement, etc.).

---

## Key NPM Scripts

```bash
npm run dev                     # Start dev server
npm run build                   # Production build
npm run oracle                  # Start AI oracle agent
npm run market-creator          # Start market creator
npm run council                 # Start council worker
npm run workers                 # All three workers concurrently
npm run agents:create-wallets   # Generate 12 EOAs → .env.local
npm run agents:fund             # Fund agents from FUNDER_PRIVATE_KEY
npm run deploy:contract         # Deploy Mimir.sol to Base Sepolia
npm run compile:contract        # solc check (errors, warnings, bytecode size)
npm run check:terms             # Guardrail: no pre-Base chain or bespoke-402 residue
npm run test:smoke              # Node smoke tests
```

---

## Smart Contract: Mimir.sol

### Key constants
- `MIN_STAKE = 2 * 10**6` — 2 USDC (ERC-20, 6 decimals)
- `MAX_CHALLENGERS = 100`
- `DEFAULT_PAYOUT_BPS = 20_000` — 2x for fixed odds
- `CHALLENGE_LOCK_SECONDS = 60` — anti-sniping window before deadline

### State values
- `ST_OPEN = 0`, `ST_ACTIVE = 1`, `ST_RESOLVED = 2`, `ST_CANCELLED = 3`

### Winner side values
- `SIDE_NONE = 0`, `SIDE_CREATOR = 1`, `SIDE_CHALLENGERS = 2`, `SIDE_DRAW = 3`, `SIDE_UNRESOLVABLE = 4`

### Write functions (USDC ERC-20 — caller must `approve` the contract first)
```
createClaim(...) → claimId
createRematch(parentId, deadline, stakeAmount, inviteKey) → claimId
challengeClaim(claimId, stakeAmount, inviteKey)
resolveClaim(claimId, winnerSide, summary, confidence)  // oracle-only
cancelClaim(claimId)                                    // creator + open state only
withdraw()                                              // pull-payment fallback
```

### Payout logic
- **CREATOR_WINS**: creator receives entire pot
- **CHALLENGERS_WIN (pool)**: pro-rata share of creator stake + own stake returned
- **CHALLENGERS_WIN (fixed)**: `stake * challengerPayoutBps / 10000`
- **DRAW / UNRESOLVABLE**: full refunds

---

## Chain Config (`lib/base.ts`)

```typescript
import { baseSepolia } from "viem/chains";   // id 84532, ETH gas, BaseScan
export { baseSepolia };

export const BASE_CAIP2 = "eip155:84532";
export function getBaseRpcUrl(): string      // provider endpoint required in prod
export function paginatedGetLogs(...)        // chunked, concurrent eth_getLogs
export function weiToEth(wei: bigint): number
export function ensureBaseSepolia(ethereum)  // wallet chain switch / add
```

## Token Config (`lib/usdc.ts`)

```typescript
export const USDC_ADDRESS  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;
export function usdcToUnits(usdc: number): bigint   // display → atomic
export function unitsToUsdc(units: bigint): number  // atomic → display
```

---

## Oracle Agent (`agents/oracle/index.ts`)

1. Poll claims past deadline
2. Fetch `resolutionUrl` (optional x402 paid evidence, capped in USDC)
3. Optional council jury (`COUNCIL_SETTLEMENT=1`)
4. LLM verdict → `resolveClaim` signed with `ORACLE_PRIVATE_KEY`

```bash
npm run oracle
# requires: ORACLE_PRIVATE_KEY, LLM key, NEXT_PUBLIC_CONTRACT_ADDRESS
```

---

## Authentication

### Primary: wagmi v3
1. Click "Connect Wallet" → connector picker modal
2. Ensure Base Sepolia (84532) — auto `switchChain` on connect
3. Address available via `useWallet()`

### Fallback: Demo Relay Mode
- `NEXT_PUBLIC_DEMO_MODE=1`
- Server-side demo signers for create / challenge

---

## What is IMPLEMENTED

- [x] Solidity contract on Base Sepolia (USDC stakes, oracle-only resolution)
- [x] Off-chain AI oracle + market-creator + 10 council personas (local keys)
- [x] Pool odds and fixed odds
- [x] Market types: binary, moneyline, spread, total, prop, custom
- [x] Rivalry/rematch system
- [x] Public + private (invite-link) claims
- [x] x402 v2 agent micropayments in USDC (facilitator verify + settle)
- [x] Wagmi v3 wallet auth on Base Sepolia + Base Account one-confirmation batching
- [x] XMTP encrypted chat (feature-flagged)
- [x] English i18n, explorer, dashboard, stats, revenue, council pages
- [x] Neon read-index (optional)
- [x] Anti-sniping challenge lock + pull-payment `pendingWithdrawals`

## Working Rules

- `contracts/Mimir.sol` is the source of truth — keep `lib/mimir-abi.ts` and `lib/contract.ts` aligned
- USDC is an ERC-20 — stakes need `approve` first; ETH is gas only, never a stake
- Resolution is oracle-only — do not expose user-triggered `resolveClaim()` in UI
- Agents use local private keys in worker env only — never ship keys to Vercel/browser
- Categories: `sports`, `weather`, `crypto`, `culture`, `custom`
- Chain ID: **84532** (Base Sepolia) — do not hardcode other chain IDs
- Money is accounted in atomic integers (`amount_atomic`), never floats
