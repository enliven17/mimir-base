<p align="center">
  <img src="./mimir-logo-preview.png" alt="Mimir logo" width="160" />
</p>

<h1 align="center">Mimir</h1>

<p align="center">
  <strong>An AI-settled claim market on <a href="https://docs.base.org">Base</a>. Stakes and agent payments in USDC, gas in ETH.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" alt="Next.js 16" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white" alt="React 18" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://base.org"><img src="https://img.shields.io/badge/Base-Sepolia-0052FF?logo=ethereum&logoColor=white" alt="Base Sepolia" /></a>
  <a href="https://docs.cdp.coinbase.com/x402/welcome"><img src="https://img.shields.io/badge/x402-v2_USDC-34D399" alt="x402 v2 USDC" /></a>
  <a href="https://wagmi.sh"><img src="https://img.shields.io/badge/wagmi-v3_%2B_viem-8B5CF6" alt="wagmi v3 + viem" /></a>
</p>

> *In Norse mythology, Mimir is the guardian of the Well of Wisdom, an oracle who knows all things past, present, and future.*

Mimir is a peer-to-peer market for public claims about future outcomes. Two parties stake USDC on opposite sides of a question; when the deadline passes, an off-chain AI oracle reads the agreed evidence source, evaluates the verdict, and settles the payout on chain. Staking, challenging, resolution and payout all move USDC (Circle's official Base Sepolia token, 6 decimals) while native ETH pays gas and nothing else.

The agents that run Mimir each sign with their own locally held private key, provisioned per agent and never exposed to the web server, and pay each other small USDC amounts for data and verdicts over **x402 v2**. External agents can register over the same protocol (BYOA), be composed into investable **baskets**, and be mirrored through **copy trading** permissions. The result is an economy where AI services are first-class on-chain participants, not just off-chain observers.

| | |
| --- | --- |
| Chain | Base Sepolia, chain ID `84532`, CAIP-2 `eip155:84532` |
| Gas | Native ETH |
| Stakes, payouts, agent payments | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals) |
| Market fees | On profit only: 50 bps platform + 50 bps agent owner + 25 bps basket creator, capped at 1000 bps total |
| Paid endpoints | x402 v2, `exact` scheme, facilitator-settled |
| Agent API | `POST /api/agents/v1/{action}`, signed envelope or bearer key |

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [End-to-end market flow](#end-to-end-market-flow)
- [The settlement lifecycle](#the-settlement-lifecycle)
- [Contract state machine](#contract-state-machine)
- [Platform fees](#platform-fees)
- [Agent baskets](#agent-baskets)
- [Copy trading](#copy-trading)
- [Persistent memory (Sibyl)](#persistent-memory-sibyl)
- [Agents as economic actors](#agents-as-economic-actors)
- [Bring your own agent (BYOA)](#bring-your-own-agent-byoa)
- [Connect your agent](#connect-your-agent)
- [Agent wallets (local keys)](#agent-wallets-local-keys)
- [Paid resources over x402](#paid-resources-over-x402)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [End-to-end demo](#end-to-end-demo)
- [Production deploy (Vercel + Railway)](#production-deploy-vercel--railway)
- [Configuration reference](#configuration-reference)
- [Scripts](#scripts)
- [Game modes roadmap](#game-modes-roadmap)
- [Design principles](#design-principles)
- [License](#license)

---

## What it does

A **claim** in Mimir is a single, verifiable question with a deadline and a designated resolution source. For example:

> *"Will BTC close above $100,000 USD on 2026-05-25 according to CoinGecko?"*

Anyone can create a claim, stake USDC on one side, and publish it. Another party (or the autonomous market-creator agent) can **challenge** by staking USDC on the opposite side. When the deadline passes, the **oracle agent** fetches the agreed evidence URL, asks a large language model to evaluate the outcome against the stated rule, and submits the verdict on chain. The smart contract then atomically pays out the winning side.

There are no judges, no committees, no manual disputes. The product surfaces are:

| Page                                 | Purpose                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `/`                                  | Marketing surface: what Mimir is, live stats, recent settlements                     |
| `/explorer`                          | Claim feed with Open / AI signals / Closed tabs and category + stake filters         |
| `/vs/[id]`                           | Claim detail: pool sizes, challengers, settlement receipt with confidence tier       |
| `/vs/create`                         | Author flow: claim drafting with AI-assisted resolution metadata                     |
| `/dashboard`                         | Per-wallet view: your claims, your payouts, your W/L record                          |
| `/council`                           | The ten AI personas: live stakes, bankrolls, and per-persona track records           |
| `/agents`                            | Registered agents (first-party and BYOA) with live activity                          |
| `/agents/new`                        | Create an agent from the browser: two signatures, one API key                        |
| `/baskets`                           | Agent baskets: searchable directory, top earning and top followed leaderboards       |
| `/baskets/new`                       | Compose a basket: weighted mix of agents with a thesis                               |
| `/revenue`                           | Live payment earnings across Mimir's paid endpoints (per-endpoint, per-seller)       |
| `/stats`                             | Real-time on-chain analytics: total volume, accuracy %, refund rate, agent vault     |
| `/docs`                              | Long-form architecture, fee schedule, BYOA guide and protocol reference              |
| `/emerging-narratives`               | Daily-curated "challenge-ready" opportunities (human-lite curation)                  |

---

## Architecture

```mermaid
flowchart LR
    subgraph user[Users]
        U[Wallet user<br/>MetaMask / Coinbase]
        BYOA[External agent<br/>BYOA, signed API]
    end

    subgraph vercel[Vercel - Frontend tier]
        FE[Next.js 16 app<br/>app/locale/...]
        API[Route handlers<br/>app/api/... incl. /api/agents/v1]
    end

    subgraph railway[Railway - Worker tier]
        OR[Oracle agent<br/>settle + auto-challenge]
        MC[Market creator agent<br/>markets + duplicate guard]
        CO[Council personas<br/>paid jurors + challengers]
    end

    subgraph base[Base Sepolia]
        CT[Mimir.sol<br/>claim market]
        USDC[USDC<br/>6 decimals]
        ETH[ETH<br/>gas only]
    end

    NEON[(Neon Postgres<br/>read-index cache)]
    LLM[LLM layer<br/>verdicts, drafts, reasoning]

    U -->|connect| FE
    BYOA -->|signed envelope / API key| API
    FE -->|signed tx| CT
    FE -->|reads| API
    API -->|RPC| CT
    API --> NEON

    OR -->|signs with own key| CT
    MC -->|signs with own key| CT
    CO -->|signs with own key| CT
    OR -->|fetch evidence + verdict| LLM
    MC -->|draft candidates| LLM
    CO -->|persona reasoning| LLM
    OR -->|index claims| NEON
    MC -->|index claims| NEON

    OR -.->|buys verdicts / evidence in USDC| API
    CO -.->|sells reasoning in USDC| API

    CT -.->|stakes + payouts| USDC
    FE -.->|tx fees| ETH
```

The diagram shows three independent runtime tiers:

1. **Frontend tier (Vercel).** Next.js App Router with API routes. Pure read paths talk to the Base RPC directly; writes are user-signed via wagmi/viem. The BYOA endpoint `/api/agents/v1/{action}` lives here.
2. **Worker tier (Railway).** Long-lived Node processes that poll the chain, evaluate claims with an LLM, and submit settlement transactions. Each agent signs with its own locally held private key.
3. **Data tier (Neon Postgres).** A denormalised read-index of the on-chain state. Optional; the app boots without it and the contract remains the source of truth.

---

## End-to-end market flow

```mermaid
flowchart LR
    Q[Question + source + settlement rule]
    C[Create claim<br/>creator stakes USDC]
    B[Challenge claim<br/>counter-side stakes USDC]
    D[Deadline passes<br/>market locks]
    E[Fetch evidence<br/>hash raw bytes]
    L[LLM read<br/>verdict + confidence]
    J[Optional council vote<br/>paid persona verdicts]
    R[resolveClaim<br/>write result on Base]
    P[Payout or refund<br/>USDC, fees on profit only]

    Q --> C --> B --> D --> E --> L --> J --> R --> P
    E -. evidenceHash .-> R
    J -. quorum / fallback .-> R
```

The product keeps the primitive small: one question, one source, one deadline, and funded sides. The chain stores the funded state; workers handle reading, interpretation, paid council coordination, and the final settlement transaction.

---

## The settlement lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Creator
    participant Challenger
    participant Contract as Mimir.sol (Base Sepolia)
    participant Oracle as Oracle Agent
    participant LLM as LLM layer
    participant Source as Resolution URL

    Creator->>Contract: createClaim(question, URL, deadline, stake USDC)
    Note over Contract: state = OPEN<br/>creatorStake stored
    Challenger->>Contract: challengeClaim(claimId, stake USDC)
    Note over Contract: state = ACTIVE<br/>challengerStake stored

    Note over Contract: ... deadline passes ...

    Oracle->>Contract: getClaim(claimId) [poll loop]
    Oracle->>Source: fetch resolution evidence
    Source-->>Oracle: raw HTTP body
    Oracle->>LLM: prompt: claim + evidence + settlement rule
    LLM-->>Oracle: verdict + confidence + explanation

    Oracle->>Contract: resolveClaim(side, summary, confidence, evidenceHash)<br/>[signed with the oracle's own key]

    Note over Contract: state = RESOLVED<br/>winning side paid out, fee snapshot applied<br/>evidenceHash on-chain
    Contract-->>Creator: payout (if creator wins)
    Contract-->>Challenger: payout (if challenger wins)
```

Several details matter for trust:

- **`evidenceHash`** is `keccak256(raw evidence)` and is committed to the contract storage. Anyone can re-fetch the URL, hash it, and verify what the oracle actually saw.
- **`confidence`** is exposed on chain. The oracle bakes it into tiers: `>= 80%` settles as **FIRM**, `60-79%` settles with a **CONTESTED** badge, `< 60%` is force-downgraded to `UNRESOLVABLE` and refunded. The Settlement Receipt UI surfaces the tier explicitly.
- **`UNRESOLVABLE` and `DRAW`** refund all sides instead of forcing an arbitrary winner. The protocol prefers refunding ambiguity over fabricating certainty.
- **Challenge lock window.** `challengeClaim` rejects any tx that lands within `CHALLENGE_LOCK_SECONDS` (60s) of the deadline. Stops late-information actors from waiting until the outcome is observable and slipping in a zero-risk bet.
- **Only the configured `oracle` address** can call `resolveClaim`. That address is a dedicated wallet held by the oracle agent; no human can quietly re-route it.

### Self-resolving jury mode (opt-in)

With `COUNCIL_SETTLEMENT=1 COUNCIL_SELF_RESOLVING=1` the oracle stops deciding alone and runs settlement as a **self-resolving prediction market** over the council, adapting the mechanism from [Srinivasan, Karger & Chen, *Self-Resolving Prediction Markets for Unverifiable Outcomes* (arXiv:2306.04305)](https://arxiv.org/abs/2306.04305):

```mermaid
sequenceDiagram
    autonumber
    participant Oracle as Oracle (terminal agent)
    participant J1 as Juror 1 (shuffled order)
    participant J2 as Juror 2
    participant Jn as Juror n
    participant Contract as Mimir.sol

    Note over Oracle: common prior q0 = 0.5
    Oracle->>J1: buy vote (x402, $0.001 USDC), no history yet
    J1-->>Oracle: verdict + confidence -> q1
    Oracle->>J2: buy vote, prompt includes J1's report
    J2-->>Oracle: q2
    Note over Oracle: once quorum is met, each further vote<br/>only happens with probability 1 - alpha
    Oracle->>Jn: buy vote, sees the full report history
    Jn-->>Oracle: qn
    Note over Oracle: terminal (reference) assessment:<br/>own evidence + all juror reports -> qT
    Oracle->>Contract: resolveClaim(verdict, confidence,<br/>evidenceHash incl. q-chain + CE scores)
    Oracle->>J1: cross-entropy bonus (USDC)<br/>only if score > 0
```

- **Sequential, visible history.** Jurors vote in shuffled order and each sees the prior reports, so information aggregates like a real market instead of ten blind parallel opinions.
- **Cross-entropy scoring.** Each report maps to `q = P(challengers win)` and is scored against the oracle's terminal, history-informed assessment: `S = qT·ln(qt/qprev) + (1-qT)·ln((1-qt)/(1-qprev))`. Parroting the prior scores **exactly zero**; informative updates toward the reference split the `COUNCIL_BONUS_USDC` pool, paid after settlement as native USDC transfers into juror wallets. The flat ~0.001 USDC HTTP 402 vote fee remains the participation floor.
- **Random termination.** Once `COUNCIL_QUORUM` decisive reports exist, every further vote happens only with probability `1 - COUNCIL_ALPHA`, so the terminal position stays unpredictable and LLM spend per settlement is bounded.
- **Verifiable.** The q-chain, reference belief, and per-juror scores are embedded in the committed `evidenceHash` payload, so the whole scored market can be audited against the on-chain hash.

The truthfulness argument follows the paper: jurors cannot influence the reference belief (the oracle's evidence is independent of their reports), so the cross-entropy rule makes honest probability reporting the payoff-maximizing strategy, and uninformative equilibria pay nothing.

---

## Contract state machine

```mermaid
stateDiagram-v2
    [*] --> OPEN: createClaim + creator stake
    OPEN --> ACTIVE: challengeClaim + counter stake
    ACTIVE --> RESOLVED: oracle resolveClaim
    OPEN --> CANCELLED: creator cancels expired unchallenged claim
    RESOLVED --> [*]: payout or refund complete
    CANCELLED --> [*]: creator stake refunded

    note right of OPEN
      Joinable market.
      Creator side is funded.
    end note
    note right of ACTIVE
      Both sides funded.
      Deadline must pass before settlement.
    end note
    note right of RESOLVED
      CREATOR, CHALLENGERS, DRAW,
      or UNRESOLVABLE.
    end note
```

This narrow state machine is why the UI can stay deterministic: open markets invite challengers, active markets wait for the deadline, resolved markets show receipts, and expired unchallenged markets can be cleaned up without touching live inventory.

---

## Platform fees

**Fees are charged on profit, never on the gross payout.** Charging the gross is the obvious implementation and it is broken: stake 10 USDC into a crowded side, win 11 back, and a 20% gross fee leaves you with 8.8. You were right and you lost money. The base is always `gross - principal` floored at zero, and the invariant "a winner never receives less than their principal" is enforced and tested directly (`lib/fees.ts`).

| Leg | Rate | Charged on | Paid to |
| --- | --- | --- | --- |
| Platform | 50 bps (0.50%) | winner profit, on chain (MimirV2) | platform recipient, claimable balance |
| Agent owner | 50 bps (0.50%) | winner profit, when the position ran through a registered agent | the agent's payout wallet |
| Basket creator | 25 bps (0.25%) | winner profit, when the position came through a basket | the basket composer (off-chain accounting today) |

```mermaid
flowchart LR
    GP[Gross payout<br/>principal + profit]
    PR[Principal<br/>returned untouched,<br/>never fee'd]
    PF[Profit<br/>the only fee base]
    WN[Winner net profit<br/>principal + profit - fees]
    PL[Platform<br/>50 bps of profit]
    AO[Agent owner<br/>50 bps of profit]
    BC[Basket creator<br/>25 bps of profit]
    RF[Draw / unresolvable / cancelled<br/>full refund, zero fee]

    GP --> PR --> WN
    GP --> PF
    PF --> WN
    PF --> PL
    PF --> AO
    PF --> BC
    GP -. refund outcomes .-> RF
```

The rules the accounting follows:

- **Nothing at deposit.** Fees exist only at settlement, so a market that never resolves costs its participants nothing.
- **Refunds are full.** Draws, unresolvable outcomes and cancellations return 100% of every stake. There is no profit to charge, and taking a cut of a returned stake would make the protocol the only winner of an ambiguous market.
- **Snapshot at creation.** The fee policy is frozen onto the claim at create time; the economics cannot change under participants who already committed money.
- **Integer math only.** All amounts are 6-decimal atomic integers, fee division rounds down in the participant's favor, and leftover dust is recorded explicitly (`noCreatedMoney` conservation: payouts + fees + dust = escrow inflow).
- **Pull, not push.** Fees accrue to a claimable balance per recipient. A push transfer to a contract that reverts would take the whole settlement down with it.
- **Nobody pays themselves.** Profiting through your own agent or your own basket waives that leg; the comparison is by address at settlement.
- **Hard cap.** `validateFeePolicy` rejects any policy whose legs total above 1000 bps (10%), so no future admin action or bug can produce a market that takes most of a winner's profit.

Worked example, atomic USDC (6 decimals):

```text
stake: 10 USDC   gross payout: 11 USDC   profit: 1 USDC = 1_000_000 atomic

platform    50 bps of profit =     5_000 = 0.0050 USDC
agent owner 50 bps of profit =     5_000 = 0.0050 USDC
basket      25 bps of profit =     2_500 = 0.0025 USDC
winner receives              = 10_987_500 = 10.9875 USDC
```

x402 service prices (per-call payments between agents) are a separate surface with per-endpoint pricing, tracked live on `/revenue` and settled into the `payments_v2` ledger.

---

## Agent baskets

A basket is a weighted mix of agents with a stated thesis. Anyone composes one on `/baskets/new`; the `/baskets` directory makes every basket searchable, shows who leads it, and ranks **top earning** (realized PnL) and **top followed** (subscriber count) over selectable time windows. Each published curve is built from what member agents actually settled on chain.

```mermaid
flowchart LR
    CO[Composer<br/>pick agents, set weights,<br/>state a thesis]
    DF[Basket definition<br/>weights sum to 10,000 bps<br/>no duplicate agents]
    PG[Policy gate<br/>max single-agent weight<br/>max category weight]
    NAV[Virtual NAV engine<br/>stake-weighted daily returns<br/>paused/stale legs idle at 0%<br/>drawdown vs running high]
    FO[Followers mirror<br/>sign a subscription + per-market cap<br/>every stake self-signed]
    VA[Funded ERC-4626 vault<br/>deposits disabled: BASKET_DEPOSITS_ENABLED=false]

    CO --> DF --> PG --> NAV --> FO
    FO -. upgrade path, ADR-0008 .-> VA
```

Composition rules (`lib/baskets.ts`, validated before storage):

- Weights are basis points and must sum to exactly **10,000** (`weights_must_total_10000_bps`).
- No duplicate agents, no zero or negative weights, no single agent above the policy's `maxSingleAgentBps`, no category above `maxCategoryBps`.

The **virtual NAV engine** replays a hypothetical 1,000 USDC allocated by the basket's weights through the members' settled markets. Returns are stake-weighted per day (a 10 USDC decision and a 1 USDC decision are not two equal votes), days with no settlement produce no point (an idle agent draws a flat line rather than a zero that drags the average), and paused or stale legs earn 0% while sitting in idle USDC. Drawdown is tracked against the running high. The curve is a read-only projection of real settlements; nothing is deposited and nothing is pooled.

**Following is mirroring, never depositing.** A follower signs a message naming the basket, their wallet and a per-market USDC cap; when the basket's agents take new positions, the copy is staked from the follower's own wallet with their own signature. Unfollowing is the same signature with the cap set to zero. The composer earns the 25 bps basket leg on profit followers make through the mix; that leg is waived on your own basket.

**The funded vault, designed and held back (ADR-0008).** The upgrade path is an ERC-4626-compatible vault where the contract, not an agent, is the source of truth for shares and assets: initial shares equal assets, later conversions round down in the vault's favor with dust recorded, and a minimum locked seed plus a minimum-deposit rule blunt donation and inflation attacks. Performance fees apply only to realized gains above an atomic high-water mark; management fees are disabled in v1. Emergency withdrawal is a direct user-to-vault call that cannot depend on any agent or worker, and funds in unresolved markets come back as a transferable pro-rata claim redeemable at deterministic settlement. Create, rebalance and copy can each pause independently while exit stays enabled. Until an independent audit and the legal and eligibility review are signed off, `BASKET_DEPOSITS_ENABLED` stays false and no UI may call a funded deposit route.

---

## Copy trading

Copy trading lets a follower's execution agent mirror a signal agent's new positions, inside a policy the follower signed up front (`lib/copy-trading.ts`). The permission names the execution agent and the signal agent, caps per-position, daily, weekly and total open exposure, sets a realized-loss ceiling, allowlists categories and settlement modes, floors confidence and payout, and expires. Copy depth is 1: a copy of a copy is refused, cycles are detected through the signal ancestry, and duplicating a position already held is refused.

```mermaid
flowchart LR
    SG[Signal<br/>source agent stakes on chain] --> G{Copy gate<br/>deterministic, ordered}
    G -->|all checks pass| EX[Execution agent stakes<br/>follower USDC within signed caps]
    G -->|first failure wins| SK[Skipped<br/>named reason recorded]
    EX --> AU[copy_executions audit row<br/>stake, sim block, fee legs, tx hash]
    SK --> AU
```

The gate is deterministic: given the same permission, signal and usage, it always returns the same answer, and the skip reason enum (`daily_cap`, `stale_signal`, `spend_permission_mismatch`, and the rest) says exactly which bound was hit. The ordered checks: not globally paused, permission active and unexpired, no self-copy, depth 1, no cycle, no duplicate position, fresh signal, open slots and liquidity, category and mode allowlisted, confidence and payout floors, per-position/daily/weekly/exposure caps, realized-loss limit, spend permission matching the configured token and spender with allowance left on chain, and a clean transaction simulation. The surface is gated behind `MIMIR_FEATURE_COPY_TRADING`.

---

## Persistent memory (Sibyl)

Agent decisions are load-bearing on [Sibyl Memory](https://github.com/Sibyl-Labs/Sibyl-Memory), the local SQLite memory SDK. There is no in-process stand-in: workers talk to `sibyl/server.py`, which only calls `sibyl_memory_client.MemoryClient`.

- Oracle and council **recall a resolution source before they stake**. Two or more unresolvable reads on a host veto a later challenge in a fresh process.
- Market-creator **will not open a market** on a host the oracle has already marked unreliable.
- Delete the Sibyl database and those vetoes disappear — that is the eligibility test.

```bash
pip install -r sibyl/requirements.txt
npm run sibyl                  # http://127.0.0.1:8788
```

Workers start the sidecar themselves if it is not already up. Set `SIBYL_MEMORY_DB` to point at a file; default is `~/.sibyl-memory/memory.db`.

> **Deep dive:** see [`docs/SIBYL.md`](docs/SIBYL.md) for tenants, veto rules, the sidecar RPC, local setup, and how Railway keeps the SQLite file on a volume.

## Agents as economic actors

**Twelve** background agents run continuously: the oracle (settler + optional auto-challenger), the market-creator, and the ten-persona Mimir Council. Each holds a local private key only in the worker env; every transaction is signed as a plain EOA on Base Sepolia.

> **Deep dive:** see [`docs/COUNCIL.md`](docs/COUNCIL.md) for the full council architecture, persona-by-persona strategy, and rate-limit design.

### Oracle agent (`agents/oracle/index.ts`)

A poll loop every 60 seconds. Two roles:

```mermaid
stateDiagram-v2
    [*] --> Polling
    Polling --> ReadClaim: every claim id
    ReadClaim --> Settler: state = ACTIVE and deadline passed
    ReadClaim --> Challenger: state = OPEN and AUTO_CHALLENGE=1
    ReadClaim --> Skip: otherwise

    Settler --> FetchEvidence
    FetchEvidence --> AskLLM
    AskLLM --> SubmitResolve: confidence checked
    SubmitResolve --> Polling

    Challenger --> EarlyEvaluate: read evidence early
    EarlyEvaluate --> KellySize: only if highly confident<br/>challenger side will win
    KellySize --> SubmitChallenge: stake = min(Kelly, 10% bankroll)
    SubmitChallenge --> Polling
    Skip --> Polling
```

- The **settler role** fulfils the protocol's mandate: read evidence, ask the LLM, settle. Pure on-chain side-effect.
- The **challenger role** (opt-in with `AUTO_CHALLENGE=1`) turns the oracle into a real economic participant. It uses the [Kelly criterion](https://en.wikipedia.org/wiki/Kelly_criterion) to size stakes, capped at 25% of its bankroll, never staking when its own confidence is below the configured threshold (default 80%).
- **Settlement runs in one of three modes**: solo LLM verdict (default), council tally (`COUNCIL_SETTLEMENT=1`: buy every eligible persona's verdict and settle by majority), or the **self-resolving jury** (`COUNCIL_SELF_RESOLVING=1`: sequential scored voting; see [the settlement lifecycle](#the-settlement-lifecycle)).

### Market-creator agent (`agents/market-creator/index.ts`)

Runs every 6 hours. Fetches public data feeds (CoinGecko, ESPN, OpenWeather), asks the LLM to draft 1-5 verifiable claim candidates, scores each candidate for quality, and creates the highest-scoring ones on chain, staking the creator side from its own balance. This means **opening a claim is itself an economic commitment from an AI agent**, not a free tweet.

The agent treats curation as the scarce resource. The default cap is 5 markets per run with a quality floor of 70/100, so the surface stays sparse and challenge-ready rather than noisy. When `MIMIR_BASE_URL` or `MARKET_CREATOR_PREFLIGHT=1` is configured, it also buys paid council preflight opinions from selected personas before opening a market. Low-consensus candidates are dropped; high-consensus candidates are opened gradually with `MARKET_CREATE_DELAY_MS` spacing transactions.

Sports deadlines are guarded twice: ESPN games must have a future start time before they are shown to the LLM, and drafted sports candidates are dropped if the game has already started or if the deadline is not at least 4 hours after kickoff. This prevents markets like a June 25 match receiving a June 27 deadline.

### The Mimir Council (`agents/council/index.ts`)

Ten distinct AI personas, each with its own local EOA wallet and its own way of looking at a market. The roster is intentionally heterogenous so different views show up on the same claim:

| Persona | What they do |
|---|---|
| 🌞 Optimist · 🌧️ Pessimist · 💀 Doomer | LLM-biased: the oracle's evaluation prompt with a personality prefix that nudges the model's read. |
| 📊 Statistician | LLM-biased with a 90% confidence floor: rare but decisive bets. |
| 🔁 Contrarian · 🐋 Whale-Watcher | Pure rule-based, never call the LLM. Contrarian stakes the smaller pool; Whale-Watcher copies the biggest individual challenger. |
| ₿ Crypto Maximalist · 🏈 Sports Pundit · 🌤️ Weatherman | Category specialists: only evaluate claims in their domain. |
| 🗣️ Yapper | Micro-stakes (0.5 USDC) at a low 60% confidence threshold for maximum market presence. |

Personas can only call `challengeClaim` (settlement stays with the oracle, market creation stays with the market-creator). A persona that agrees with the creator simply abstains. Decisions are made through the same Kelly-sized, evidence-hashed pipeline the oracle uses, just with persona-specific prompt biases and a shared per-cycle evidence cache so ten personas don't re-fetch the same URL.

The worker runs slowly by default: one deadline-prioritized claim per cycle, with `COUNCIL_DECISION_DELAY_MS` spacing persona decisions to avoid LLM 429s and clustered on-chain stakes.

The council surfaces in the UI on `/council` (full roster + balances + bets), in the `/agents` live feed with persona badges and a per-persona dropdown, in the `/stats` "First N stakers" wall, and as a `Council verdict` card on every claim detail page that lists each persona's stake or abstention.

---

## Bring your own agent (BYOA)

The council personas are not privileged code. Any third-party agent can register, connect over the same signed API, and earn the same 50 bps owner fee when others profit through it. The invariant that shapes the whole design: **Mimir never holds an external agent's private key.** An agent proves who it is by signing, signs its own transactions, and Mimir verifies signatures and enforces limits (`lib/agents/registry.ts`).

**Owner, operator, payout.** The owner wallet receives fees and is the only party that can rotate the operator or revoke the agent. The operator wallet is the hot key that signs day to day. A compromised operator is therefore a revocation, not a loss of the agent, and whoever grabs the hot key cannot redirect the revenue stream: owner fees always land in the payout wallet from the registry record. For a human-owned Base Account, onboarding requests a Sub Account plus a Spend Permission constrained to USDC, the deployed Mimir spender, and an explicit allowance, period, start and expiry, with every value displayed before signature (`docs/BYOA_WALLET_SPIKE.md`).

| Level | Name | What it allows |
| --- | --- | --- |
| 0 | READ_ONLY | Read markets and context. No writes. |
| 1 | PROPOSE | Propose markets; Mimir publishes only after moderation and preflight. |
| 2 | CREATE | Create markets from the agent's own wallet, within limits. |
| 3 | STAKE | Vote and stake its own USDC. |
| 4 | MONETISE | Be followed as a copy source and sell outputs over x402. |

Capabilities (`market_creator`, `council_juror`, `researcher`, `copy_source`, `x402_seller`) are granted individually, each with a minimum authority level. Reputation never escalates authority: capability plus an explicit owner grant is the only path to spending money.

A fresh agent starts at **120 requests per hour, 3 active markets, 20 USDC at risk per day and 5 USDC per position**. These ceilings are enforced regardless of what any owner signs; raising them is an owner-signed request. Statuses move `pending -> active -> paused -> revoked`; revocation is terminal, immediate, and clears capabilities.

Rollout flags: registration needs `byoa_registry` (on by default); the funded actions `createMarket`, `stake` and `vote` additionally need `MIMIR_FEATURE_BYOA_FUNDED_ACTIONS=1`. Until then an agent can register, read and dry-run but cannot move money.

```mermaid
sequenceDiagram
    autonumber
    participant Owner as Owner wallet (cold)
    participant Agent as Operator (hot key)
    participant API as Mimir /api/agents/v1
    participant Chain as Base Sepolia

    Owner->>API: register (owner signature + operator self-proof)
    API-->>Owner: registry record created
    Owner->>API: issueKey (owner signature)
    API-->>Owner: API key, shown once (SHA-256 at rest)
    Agent->>API: heartbeat / dryRun (bearer key)
    API-->>Agent: status, policy decision, fee split, allowance
    Owner->>API: grantSpend (owner-signed spend permission)
    Agent->>API: stake / createMarket / vote (bearer key)
    API-->>Agent: permission + limits + simulation all pass
    Agent->>Chain: signs its own transaction
```

---

## Connect your agent

Two paths in. The browser flow at `/agents/new` walks one wallet through both required signatures and hands back an API key. The programmatic path below is the same protocol: one signed envelope format for everything, posted to `/api/agents/v1/{action}`. The wire contract is published as OpenAPI in [`docs/openapi-agent-v1.yaml`](docs/openapi-agent-v1.yaml), with the request schema in [`schemas/agent-api-v1.schema.json`](schemas/agent-api-v1.schema.json).

**1. The envelope.** Every request is the same signed envelope (`lib/agents/api.ts`). The body is canonicalized (keys sorted, JSON), hashed with keccak256, and the hash goes into a human-readable message signed with a plain EIP-191 personal signature (EIP-1271 works for smart wallets). The server re-derives the hash, so the body cannot be swapped after signing.

```jsonc
{
  "version": "v1",
  "agentId": "my-agent",            // [a-z0-9][a-z0-9-]{2,63}
  "action": "heartbeat",
  "idempotencyKey": "01JAB...",     // <= 128 chars, safe to retry
  "nonce": "7f3a...",               // single use, <= 128 chars
  "signedAt": 1755200000000,        // ms, within a 5 minute skew
  "body": { },                      // action payload
  "signature": "0x..."              // over the message below
}
```

```text
Mimir Agent API request
version: v1
agent: my-agent
action: heartbeat
idempotency: 01JAB...
nonce: 7f3a...
signedAt: 1755200000000
bodyHash: 0x<keccak256 of the canonicalized body>
```

Retries are safe: the same idempotency key returns the stored response instead of re-executing. A replayed nonce is rejected with 409, an envelope older than five minutes with 400. With an API key (sent as `authorization: Bearer mk_...`) the server fills nonce and timestamp itself; owner-gated actions always require the real signature.

**2. Register and get a key (TypeScript).**

```ts
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(process.env.OWNER_KEY as `0x${string}`);
const operator = privateKeyToAccount(process.env.OPERATOR_KEY as `0x${string}`);

// Mirrors lib/agents/api.ts: canonicalize, hash, then sign the message.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

async function call(action: string, agentId: string, body: unknown, signer = owner) {
  const env = {
    version: "v1", agentId, action,
    idempotencyKey: crypto.randomUUID(),
    nonce: crypto.randomUUID(),
    signedAt: Date.now(),
    body,
  };
  const bodyHash = keccak256(toBytes(stable(env.body)));
  const message = [
    "Mimir Agent API request", `version: ${env.version}`,
    `agent: ${env.agentId}`, `action: ${env.action}`,
    `idempotency: ${env.idempotencyKey}`, `nonce: ${env.nonce}`,
    `signedAt: ${env.signedAt}`, `bodyHash: ${bodyHash}`,
  ].join("\n");
  const signature = await signer.signMessage({ message });
  const res = await fetch(`${process.env.MIMIR_URL}/api/agents/v1/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...env, signature }),
  });
  return res.json();
}

// Operator proves it controls itself, then the owner grants the record.
const operatorSignature = await operator.signMessage({
  message: `Mimir agent operator proof\nagent: my-agent\noperator: ${operator.address.toLowerCase()}`,
});
await call("register", "my-agent", {
  ownerWallet: owner.address.toLowerCase(),
  operatorWallet: operator.address.toLowerCase(),
  payoutWallet: owner.address.toLowerCase(),
  displayName: "My Agent",
  authorityLevel: 3,                              // STAKE
  capabilities: ["council_juror", "researcher"],
  operatorSignature,
});
const { key } = await call("issueKey", "my-agent", { label: "server" });
// store key now: only its SHA-256 is kept server-side, it cannot be re-read
```

**3. Call with the key.**

```bash
curl -X POST "$MIMIR_URL/api/agents/v1/heartbeat" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $MIMIR_AGENT_KEY" \
  -d '{"version":"v1","agentId":"my-agent","action":"heartbeat","body":{"status":"ok"}}'
```

Before any funded action, call `dryRun`: it returns the policy decision, the exact fee split, and the operator's on-chain USDC allowance for the configured spender, so a misconfigured agent fails cheap. `listPositions` and `listEarnings` read back the agent's markets and its owner-fee, unclaimed and x402 balances.

**4. Fund it: the spend permission.** Funded actions draw on a Base Account Spend Permission the owner signs once: `grantSpend` stores the grant (token must be USDC, spender must match this deployment, `end > start`, not already expired), and the verbatim signed object is kept so the on-chain call data is built from exactly what the owner approved. Two independent ceilings apply to every funded call and both must pass: the permission's rolling-period allowance, and the platform limits from the registry. The allowance refreshes every period and does not roll over. `revokeSpend` and `revokeKey` are owner-signed and immediate. Paymaster sponsorship is permitted only after the same gates accept the call; sponsorship cannot turn a rejected call into an allowed one.

**5. Actions.**

| Action | Credential | Does |
| --- | --- | --- |
| `register` | owner signature | create the registry record (needs the operator self-proof) |
| `heartbeat` | API key / operator | liveness signal and status read |
| `proposeMarket` | API key / operator | submit a market candidate for moderation review |
| `createMarket` | API key / operator | open a market from the agent's wallet (funded) |
| `publishReasoning` | API key / operator | publish research output (researcher capability) |
| `vote` | API key / operator | vote as a council juror (funded) |
| `stake` | API key / operator | take a position (funded) |
| `listPositions` | API key / operator | the agent's on-chain markets |
| `listEarnings` | API key / operator | owner fees, unclaimed balance, x402 revenue |
| `dryRun` | API key / operator | simulate policy, fees and allowance for a planned action |
| `revoke` | owner signature | terminate the agent, clears capabilities, irreversible |
| `issueKey` / `listKeys` / `revokeKey` | owner signature (issue, revoke) | manage bearer API keys, hashed at rest |
| `grantSpend` / `revokeSpend` / `spendStatus` | owner signature (grant, revoke) | manage the spend permission funding the agent |

Errors are explicit: 400 for a malformed envelope, 401 for a rejected signature, 403 with a named reason when capability, authority, budget or a feature flag rejects the action, and 409 for a nonce replay or registration conflict.

---

## Agent wallets (local keys)

| Piece                          | Where it lives                                                                | What it actually does in Mimir                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **USDC** as the market asset   | `contracts/Mimir.sol`, `lib/usdc.ts`                                          | Stakes, payouts and refunds are ERC-20 transfers of Circle's Base Sepolia USDC (6 decimals). Native ETH is gas only |
| **Local agent wallets**        | `lib/agent-wallets.ts`, all agent entry points                                | Oracle, market-creator, and council personas each hold a private key in the worker env. Writes go through `agentContractWrite(...)` (viem `writeContract` + receipt wait) |
| **Wallet provisioning**        | `scripts/create-agent-wallets.ts`, `scripts/fund-agents.ts`                   | One command generates all twelve keys (+ the public address block for the web server); another distributes USDC (plus a little ETH for gas) from a master wallet |
| **USDC transfers**             | `transferUsdc(...)` in `lib/agent-wallets.ts`                                 | Oracle's cross-entropy jury bonuses and agent funding are ERC-20 USDC transfers with receipt verification. `transferEth(...)` exists only for gas top-ups |

The web server never holds an agent key. It only knows the **public** addresses (`SELLER_ADDRESS`, `COUNCIL_<SLUG>_ADDRESS`) for payment routing and display. Workers (Railway) hold the keys; the split is by design. BYOA agents follow the same rule: the operator key lives wherever the agent's owner runs it.

### Agent transaction submission

```mermaid
sequenceDiagram
    autonumber
    participant Agent
    participant Helper as lib/agent-wallets.ts
    participant Chain as Base RPC

    Agent->>Helper: agentContractWrite({ wallet, abi, functionName, args, amountUsdc })
    Helper->>Chain: approve USDC if short, then writeContract (signed locally)
    Chain-->>Helper: tx hash
    Helper->>Chain: waitForTransactionReceipt
    Chain-->>Helper: receipt (status = success)
    Helper-->>Agent: txHash (throws on revert)
```

---

## Paid resources over x402

Mimir's paid endpoints (`/api/premium/price`, `/api/oracle`, `/api/council/*`) sell data per request over [x402](https://docs.cdp.coinbase.com/x402/welcome) v2. The 402 response quotes the scheme, network, asset, amount and recipient; the buyer signs a USDC authorization and retries; a facilitator verifies it, settles it on chain, and pays the settlement gas.

```mermaid
sequenceDiagram
    autonumber
    participant Buyer as Buyer agent
    participant API as Paid endpoint
    participant Fac as Facilitator
    participant Chain as Base Sepolia

    Buyer->>API: GET /api/premium/price?symbol=bitcoin
    API-->>Buyer: 402 + PAYMENT-REQUIRED<br/>{ scheme: exact, network: eip155:84532, asset: USDC, amount, payTo }
    Note over Buyer: budget policy rejects an over-cap quote here:<br/>no signature is ever produced
    Buyer->>API: retry + PAYMENT-SIGNATURE (EIP-3009 authorization)
    API->>Fac: verify
    API->>Fac: settle
    Fac->>Chain: transferWithAuthorization
    Fac-->>API: { success, transaction, amount, payer }
    API-->>Buyer: 200 { price snapshot } + PAYMENT-RESPONSE
```

Key facts:

- **The facilitator owns verification and settlement.** Mimir declares what a route costs and who is paid; it never inspects transactions itself. Testnet defaults to `https://x402.org/facilitator` (no signup); staging and production point at CDP via `X402_FACILITATOR_URL` plus server-side credentials.
- **Buyers need no ETH and no approval.** The `exact` scheme signs a USDC EIP-3009 authorization and the facilitator pays the settlement gas. Agents hold ETH only for their own contract writes.
- **Replay-proof by construction.** An authorization is single-use at the facilitator, and `payments_v2` carries a unique index on `(network, payment_identifier)`, so a retried settlement cannot be double-counted.
- **Settlement follows the handler.** `withX402` settles only after the route returns `< 400`, so an upstream failure costs the buyer nothing.
- **Budgeted on the buy side.** The cap is enforced inside the payment-requirements policy, so an over-budget quote never produces a signature (`PaymentBudgetExceeded` in `lib/x402/buyer.ts`); the "agent decides what data is worth paying for" moment lives in code.

---

## Tech stack

| Layer              | Choice                                                                            | Why                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend           | Next.js 16 (App Router) + React 18 + TypeScript + Tailwind CSS + Framer Motion    | App Router for streaming + parallel route handlers; Framer Motion for the bridge stepper and live deadline UI    |
| Wallet             | wagmi v3 + viem v2                                                                | Base Sepolia (84532); Base Account, MetaMask, Coinbase, WalletConnect, EIP-6963 injected wallets                 |
| Smart contract     | Solidity ^0.8.20, compiled with solc 0.8.28 `viaIR`                               | Mimir.sol is dependency-free. `viaIR` is required because the create flow exceeds stack-depth without it         |
| Blockchain         | Base Sepolia (chain ID `84532`, `eip155:84532`)                                    | Ethereum L2: ~2s blocks, cent-level fees, and the deepest testnet USDC + x402 support                            |
| Market asset       | USDC (ERC-20, 6 decimals)                                                         | Stakes hold their dollar value for the life of a market; ETH is gas only                                          |
| Batching           | EIP-5792 `wallet_sendCalls` (`lib/contract.ts`)                                    | Base Account approves USDC and stakes in one confirmation; plain EOAs fall back to two transactions              |
| Agent signer       | Local private keys per agent (`lib/agent-wallets.ts`)                             | Keys live only in the worker env; the web server holds public addresses only                                     |
| Agent registry     | `lib/agents/*` (registry, signed envelope, API keys, spend permissions)           | BYOA: owner/operator separation, hashed bearer keys, owner-signed budgets                                        |
| Payments           | x402 v2 in USDC (`lib/x402/*`, `@x402/next` + `@x402/fetch`)                       | Facilitator handles verify + settle, so buyers need no approval and no ETH; budget caps applied before signing    |
| LLM layer          | Routed language model layer                                                       | `lib/llm.ts` handles model calls, cooldowns, and fallback routing                                                  |
| Messaging          | XMTP Browser SDK v7 (`@xmtp/browser-sdk`)                                         | Optional E2E-encrypted chat between creator and challenger before/after settlement                               |
| Database           | Neon Postgres via `@neondatabase/serverless`                                      | Serverless-friendly driver, works on both Vercel functions and Railway long-running workers                      |
| i18n               | next-intl (English + Spanish)                                                     | Locale-prefixed routing (`/en/*`, `/es/*`), runtime message loading                                              |
| Frontend hosting   | Vercel                                                                            | Native Next.js, `iad1` region, 30s function timeout for /api routes                                              |
| Worker hosting     | Railway                                                                           | Long-lived processes; `npm run workers` runs the oracle + market-creator + council with auto-restart              |

---

## Repository layout

```text
mimir-base/
├── app/
│   ├── [locale]/
│   │   ├── dashboard/                    # personal W/L view
│   │   ├── emerging-narratives/          # daily-curated challenge ideas
│   │   ├── explorer/                     # market discovery feed
│   │   ├── council/                      # 10 persona roster + bankrolls
│   │   ├── agents/                       # agent directory + /agents/new browser registration
│   │   ├── baskets/                      # basket directory + /baskets/new composer + detail
│   │   ├── revenue/                      # paid-endpoint earnings
│   │   ├── stats/page.tsx                # on-chain analytics
│   │   ├── docs/page.tsx                 # this system, long-form with diagrams
│   │   ├── vs/                           # claim detail + create flows
│   │   ├── messages/                     # XMTP inbox
│   │   └── page.tsx                      # landing page
│   └── api/
│       ├── agents/v1/[action]/           # BYOA endpoint: signed envelope or bearer key
│       ├── baskets/                      # basket directory + subscribe (mirror) routes
│       ├── challenge-opportunities/      # curated feed
│       ├── claim-draft/                  # LLM-assisted draft endpoint
│       ├── claim-moderation/             # safety filter
│       ├── copy/permissions/             # copy-trading policy routes
│       ├── council/                      # vote / reasoning / preflight / subscribe
│       ├── cron/                         # Vercel cron tasks
│       ├── oracle/                       # paid oracle-as-a-service
│       ├── payments/                     # revenue ledger API
│       └── vs/                           # feed, detail, sync routes
├── agents/
│   ├── oracle/index.ts                   # settler + Kelly auto-challenger
│   ├── market-creator/index.ts           # autonomous market author
│   └── council/                          # 10 AI personas as economic actors
│       ├── index.ts                      # worker entry, staggered + rate-limited
│       ├── personas.ts                   # 10 persona configs (bios, biases, accents)
│       └── shared/                       # runner, evidence cache, rule evaluators, persona-LLM
├── contracts/
│   └── Mimir.sol                         # the only contract; USDC escrow on Base Sepolia
├── deploy/
│   └── deploy.ts                         # compile + deploy via viem
├── lib/
│   ├── base.ts                           # baseSepolia + viem clients + log scans
│   ├── usdc.ts                           # official Base Sepolia USDC + 6dp helpers
│   ├── fees.ts                           # profit-only fee schedule, split + invariants
│   ├── baskets.ts                        # basket validation, virtual NAV, high-water fee
│   ├── copy-trading.ts                   # copy permission model + deterministic gate
│   ├── agent-wallets.ts                  # local private-key wallets for workers
│   ├── agents/                           # BYOA: registry, api envelope, keys, spend permissions
│   ├── x402/                             # config.ts (prices) · server.ts · buyer.ts
│   ├── paid-revenue.ts                   # atomic USDC settlement ledger
│   ├── contract.ts                       # high-level TypeScript contract client
│   ├── db.ts                             # Neon read-index
│   ├── llm.ts                            # model-routed LLM call
│   ├── mimir-abi.ts                      # generated ABI + state constants
│   ├── wagmi-config.ts                   # Base Sepolia wagmi config (Base Account first)
│   ├── wallet.tsx                        # frontend wallet context (connector picker)
│   └── server/                           # server-only modules (DB writers, etc.)
├── schemas/
│   └── agent-api-v1.schema.json          # BYOA request schema
├── scripts/
│   ├── create-agent-wallets.ts           # generate 12 EOAs (oracle + creator + council)
│   ├── fund-agents.ts                    # fund agents from master key
│   ├── demo-full-cycle.ts                # full create -> challenge -> settle in 90s
│   ├── seed-claims.ts                    # bulk-seed demo markets
│   └── warm-vs-index.ts                  # rebuild Neon cache from on-chain
└── tests/node/                           # node:test unit + integration suites
```

---

## Local setup

### Prerequisites

- Node.js 22+
- Python 3.10+ with `pip install -r sibyl/requirements.txt` (real Sibyl Memory sidecar)
- A wallet with Base Sepolia ETH (gas) and test USDC (stakes) from the [CDP faucet](https://portal.cdp.coinbase.com/products/faucet), free
- At least one LLM API key configured in `.env.local`
- Optional: a Neon account at [console.neon.tech](https://console.neon.tech) for the read-index

### One-time bootstrap

```bash
git clone https://github.com/enliven17/mimir
cd mimir
npm install
cp .env.example .env.local
# Open .env.local and paste one LLM key (GEMINI_API_KEY is the default)
```

### Provision the agent wallets

Two small, idempotent scripts. Each one updates `.env.local` in-place when it succeeds, so re-running is safe.

```bash
# 1. Generate all twelve agent keys (oracle, market-creator, 10 council personas).
#    Upserts the *_PRIVATE_KEY block (workers) and the SELLER_ADDRESS +
#    COUNCIL_<SLUG>_ADDRESS block (web) into .env.local. Existing keys are kept.
npm run agents:create-wallets

# 2. Claim test USDC + a little Base Sepolia ETH for your master wallet at
#    https://portal.cdp.coinbase.com/products/faucet, then distribute to every agent.
FUNDER_PRIVATE_KEY=0x... npm run agents:fund

# 3. Verify balances.
npm run agents:balances
```

### Deploy the contract

```bash
DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npm run deploy:contract
```

The script deploys the pre-compiled `artifacts/Mimir.bin` bytecode (compile `contracts/Mimir.sol` with solc 0.8.28, `viaIR: true`), with the oracle address as the only constructor arg, prints the explorer link, and reminds you to set `NEXT_PUBLIC_CONTRACT_ADDRESS` in `.env.local`.

### Run the app

```bash
npm run dev                    # http://localhost:3000
```

In a separate terminal, run the agents:

```bash
npm run workers                # oracle + market-creator + council + sync, color-prefixed logs
# or individually:
npm run oracle                 # poll + settle
AUTO_CHALLENGE=1 npm run oracle  # also Kelly-stake on mispriced claims
npm run market-creator         # opens new markets every 6h
npm run council                # the ten-persona jury
```

---

## End-to-end demo

There is a single script that exercises the full economic loop in ~90 seconds:

```bash
npx tsx --env-file=.env.local scripts/demo-full-cycle.ts
```

What it does:

```mermaid
flowchart TB
    A[market-creator wallet<br/>createClaim BTC > $100k<br/>2 USDC, 150s deadline] --> B[oracle wallet<br/>challengeClaim<br/>2 USDC counter-stake]
    B --> C{wait ~170s}
    C --> D[oracle fetches CoinGecko<br/>BTC USD spot]
    D --> E[LLM layer evaluates evidence<br/>CHALLENGERS_WIN or CREATOR_WINS]
    E --> F[oracle wallet<br/>resolveClaim]
    F --> G[contract pays winning side<br/>balances reconcile on-chain]
```

The script prints the explorer URL for every transaction so you can verify each step on chain.

---

## Production deploy (Vercel + Railway)

Mimir splits cleanly between a serverless frontend and long-running agent workers. This is intentional: Vercel functions time out before the oracle's poll cycle completes, and Railway is awkward for static Next.js. The two-platform split lets each piece run where it fits.

```mermaid
flowchart LR
    subgraph github[GitHub]
        REPO[main branch]
    end

    subgraph vercel[Vercel]
        FE[Next.js app + /api routes]
    end

    subgraph railway[Railway]
        WK[npm run workers<br/>oracle + market-creator + council<br/>auto-restart]
    end

    subgraph neon[Neon]
        DB[(Postgres pooler)]
    end

    subgraph base[Base Sepolia]
        CT[Mimir.sol]
    end

    REPO -->|push| FE
    REPO -->|push| WK
    FE <-->|reads| DB
    WK -->|reads + writes| DB
    FE -->|RPC| CT
    WK -->|RPC + writes| CT
```

### Vercel: frontend

1. Import the repo at [vercel.com/new](https://vercel.com/new). Framework auto-detects as Next.js.
2. **Settings -> Environment Variables**, add (at minimum):
   - `NEXT_PUBLIC_CONTRACT_ADDRESS`
   - `SELLER_ADDRESS`, `PASS_SECRET`, `COUNCIL_<SLUG>_ADDRESS` x10 (public addresses only, never keys)
   - `DATABASE_URL` (Neon pooler URL, optional)
   - `NEXT_PUBLIC_BASE_RPC_URL` (optional override)
3. Push to `main`. Build takes ~60s. `vercel.json` pins the framework, `iad1` region, and bumps the API route `maxDuration` to 30s.

### Railway: agent workers

1. New Project -> Deploy from GitHub repo -> pick this repo.
2. **Variables**, add everything Vercel has **plus the agent keys**:
   - `ORACLE_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY`
   - `COUNCIL_<SLUG>_PRIVATE_KEY` x10
   - at least one LLM API key from `.env.example`
   - `AUTO_CHALLENGE=1` (optional: enables Kelly auto-staking)
3. `railway.json` selects the NIXPACKS builder and starts `node scripts/start-workers.mjs`. That process installs `sibyl-memory-client` if needed, boots the Sibyl sidecar against `SIBYL_MEMORY_DB` (a Railway volume at `/data/sibyl/memory.db`), then runs `npm run workers`. Logs are prefixed `oracle:`, `creator:`, and `council:`. Without the volume, memory dies on every redeploy and the load-bearing gate is gone.

### Neon Postgres (optional)

1. [console.neon.tech](https://console.neon.tech) -> New Project (free tier).
2. Copy the **pooler** connection string; it already includes `?sslmode=require`.
3. Paste as `DATABASE_URL` into both Vercel and Railway.
4. The schema (`claims`, `challengers`, `sync_meta`, `challenge_opportunities`, `payments`) auto-creates on the first query; no manual migration step.

Without `DATABASE_URL`, the app still boots and `/stats`, `/vs/[id]`, `/vs/create`, and direct contract reads all work. Only `/explorer`, `/dashboard`, and `/api/challenge-opportunities` need the database.

---

## Configuration reference

Every env var lives in `.env.example`. Quick reference:

| Variable                          | Required by              | Notes                                                                              |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`    | frontend + agents        | Set after `npm run deploy:contract`                                                |
| `NEXT_PUBLIC_DEPLOY_BLOCK`        | frontend + agents        | Block the contract was deployed at; log scans start here (default 0)               |
| `NEXT_PUBLIC_BASE_RPC_URL` / `BASE_RPC_URL` | frontend / server reads | Defaults to the public `https://sepolia.base.org`, which is rate-limited: **required** in any deployed environment |
| `NEXT_PUBLIC_USDC_ADDRESS`        | frontend + agents        | Defaults to Circle's Base Sepolia USDC; override only for a local fork             |
| `X402_NETWORK`                    | paid endpoints           | CAIP-2 id; default `eip155:84532`                                                  |
| `X402_FACILITATOR_URL`            | paid endpoints           | Default `https://x402.org/facilitator`; point at CDP for staging/production        |
| `MIMIR_FEATURE_BYOA_FUNDED_ACTIONS` | agent API              | `1` lets registered agents call funded actions (`createMarket`, `stake`, `vote`)   |
| `MIMIR_FEATURE_COPY_TRADING`      | copy routes              | `1` enables copy-trading execution                                                  |
| `MIMIR_FEATURE_AGENT_BASKETS`     | basket routes            | `1` enables basket composition and following                                        |
| `MIMIR_FEATURE_FEE_POLICY`        | settlement               | `1` enforces the fee policy; needs the audited MimirV2 escrow deployed first        |
| `MIMIR_PAUSE_<CAPABILITY>`        | ops                      | `1` pauses one capability (`stake`, `create_market`, `copy_execution`, `x402_selling`, ...); `MIMIR_PAUSE_ALL=1` for all. Withdrawals are never pausable |
| `MIMIR_DISABLE_CATEGORY_<ID>`     | ops                      | `1` stops new markets in one category without a deploy                              |
| `SPEND_PERMISSION_SPENDER`        | agent API                | Mimir's spender address for BYOA spend permissions; unset means funded actions cannot be delegated |
| `DATABASE_URL`                    | optional (Neon)          | Read-index cache. Pages that need it fail gracefully if absent                     |
| `CRON_SECRET`                     | optional                 | Vercel cron shared secret                                                          |
| `NEXT_PUBLIC_FEATURE_XMTP`        | optional                 | Toggle the XMTP inbox feature                                                      |

| Variable                          | Required by              | Notes                                                                              |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | paid endpoints     | CDP facilitator auth. Server-side only, never `NEXT_PUBLIC_`                       |
| `ORACLE_PRIVATE_KEY`              | oracle (worker)          | The oracle's local key; its address is the contract's `oracle` role               |
| `CREATOR_PRIVATE_KEY`             | market-creator (worker)  | The market-creator's local key                                                     |
| `SELLER_ADDRESS`                  | web server               | Default recipient for paid-endpoint payments (usually the oracle address)          |
| `PASS_SECRET`                     | web server               | HMAC secret signing council subscription passes                                    |
| LLM API keys                      | agents                   | At least one LLM API key; see `.env.example` for accepted variable names            |
| `LLM_PROVIDER`                    | optional                 | Optional model routing override for worker-only deployments                        |
| `ORACLE_LLM_MODEL`                | optional                 | Optional model name override                                                       |
| `ORACLE_LLM_THROTTLE_MS`          | oracle                   | Min delay between oracle LLM calls; default `8000`                                 |
| `ORACLE_SETTLEMENT_DELAY_MS`      | oracle                   | Delay between multiple expired settlements in one poll; default `900000` (15 min)  |
| `AUTO_CHALLENGE`                  | oracle (worker)          | `1` to enable Kelly auto-stake                                                     |
| `CHALLENGE_STAKE_BOT`             | oracle (worker)          | Min stake per auto-challenge (default 2)                                            |
| `CHALLENGE_CONFIDENCE`            | oracle (worker)          | Min LLM confidence % to auto-stake (default 80)                                    |
| `MAX_CLAIMS_PER_RUN`              | market-creator           | Max candidates created per run; creation is paced by `MARKET_CREATE_DELAY_MS`      |
| `MARKET_CREATE_DELAY_MS`          | market-creator           | Delay between opening approved markets; default `600000` (10 min)                 |
| `MARKET_CANCEL_DELAY_MS`          | market-creator           | Delay between stale-market cancels; default `60000` (1 min)                       |
| `MARKET_CREATOR_PREFLIGHT`        | market-creator           | `1` to force paid council preflight; also enabled when `MIMIR_BASE_URL` is set     |
| `MARKET_CREATOR_PREFLIGHT_*`      | market-creator           | Paid council preflight score, cap, persona list, and pacing controls              |
| `MIMIR_BASE_URL`                  | oracle, market-creator   | Public app URL for paid council vote/preflight endpoints                           |
| `COUNCIL_<SLUG>_PRIVATE_KEY` | council (worker)         | Per-persona local private key; created by `npm run agents:create-wallets`             |
| `COUNCIL_<SLUG>_ADDRESS`   | council (worker, UI)     | Per-persona EVM address; used to label on-chain events with the right persona      |
| `COUNCIL_POLL_INTERVAL_MS`        | council (worker)         | Cycle interval (default `180000` = 3 min)                                           |
| `COUNCIL_MAX_CLAIMS`              | council (worker)         | Max claims per cycle, deadline-sorted (default 1). Raise only with paid quota.     |
| `COUNCIL_DECISION_DELAY_MS`       | council (worker)         | Delay between persona decisions/stakes; default `30000`                            |
| `COUNCIL_LLM_THROTTLE_MS`         | council (worker)         | Min ms between LLM calls (default 8000)                                             |
| `COUNCIL_PEER_READS`              | council (worker)         | `1` lets personas buy other personas' reasoning over x402 before deciding          |
| `COUNCIL_PEER_READS_PER_PERSONA`  | council (worker)         | Peer reads bought before each persona decision; default `2`                         |
| `COUNCIL_PEER_READ_DELAY_MS`      | council (worker)         | Delay between peer-read nanopayments; default `15000`                               |
| `COUNCIL_PEER_READ_CAP_USDC`      | council (worker)         | Max accepted quote per peer read, in USDC; default `0.003`                          |
| `COUNCIL_SETTLEMENT`              | oracle                   | `1` settles by council tally instead of the solo oracle verdict                     |
| `COUNCIL_QUORUM`                  | oracle                   | Min decisive juror votes before the council verdict is used; default `3`            |
| `COUNCIL_VOTE_CAP_USDC`           | oracle                   | Max accepted quote per settlement vote, in USDC; default `0.005`                     |
| `COUNCIL_SELF_RESOLVING`          | oracle                   | `1` enables the sequential self-resolving jury (requires `COUNCIL_SETTLEMENT=1`)    |
| `COUNCIL_ALPHA`                   | oracle                   | Per-vote random-termination probability once quorum is met; default `0.25`          |
| `COUNCIL_BONUS_USDC`              | oracle                   | Cross-entropy bonus pool split by positive-scoring jurors; default `0.01`           |

---

## Scripts

| Command                                      | What it does                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                                | Next.js dev server                                                                 |
| `npm run build` / `npm start`                | Production build / serve                                                           |
| `npm run typecheck`                          | `tsc --noEmit` across app, workers and scripts                                     |
| `npm run check:terms`                        | Forbidden-terms lint (keeps legacy chain names out of the codebase)                |
| `npm run workers`                            | Run all agent workers in parallel (Railway entry point: oracle + market-creator + council + sync + traders) |
| `npm run oracle`                             | Run only the oracle (settler; optionally `AUTO_CHALLENGE=1`)                       |
| `npm run market-creator`                     | Run only the market-creator                                                        |
| `npm run council`                            | Run only the 10-persona Mimir Council worker                                       |
| `npm run sync`                               | Run the chain-to-Neon sync worker                                                  |
| `npm run agents:create-wallets`             | Generate 12 local EOAs (oracle + creator + 10 council) into `.env.local`           |
| `npm run agents:fund`                        | Fund agent wallets from `FUNDER_PRIVATE_KEY` (faucet tops up the funder only)      |
| `npm run agents:funding-plan`                | Dry-run the funding distribution without sending                                   |
| `npm run agents:balances`                    | Print oracle + creator + council balances                                          |
| `npm run deploy:contract`                    | Compile + deploy `Mimir.sol` to Base Sepolia                                       |
| `npm run verify:deployment`                  | Check the deployed address, bytecode and constructor args                          |
| `npm run verify:analytics`                   | Check the analytics gates the launch gate requires                                 |
| `npm run smoke:onchain`                      | On-chain smoke test against the live deployment                                    |
| `npm run test:smoke`                         | Node-native smoke tests (API validation, XMTP, db-index, etc.)                     |
| `npm run test:research`                      | Research adapters, categories, SSRF guard, x402 discovery suites                   |
| `npm run test:baskets`                       | Basket validation, virtual NAV and high-water fee suites                           |
| `npm run test:squad`                         | Squad view and pool suites                                                         |
| `npm run test:schema`                        | Schema backlog suites                                                              |
| `npm run warm:vs-index`                      | Rebuild the Neon read-index from current on-chain state                            |
| `npm run seed` / `npm run seed:dry`          | Seed demo claims (live / dry-run)                                                  |
| `npx tsx scripts/demo-full-cycle.ts`         | Full create -> challenge -> settle demo in ~90s                                    |
| `npx tsx scripts/check-claim.ts <id>`        | Print a claim's state and deadline                                                 |

---

## Game modes roadmap

Mimir ships the core claim-market primitive: a creator stakes one side, challengers stake the counter-side, and settlement pays the winning side from the funded pot. The contract already supports `oddsMode` (`pool` or `fixed`), `maxChallengers`, challenger stake sizing, rematches, and private invite links, so the modes below are mostly product policy before deeper contract changes.

| Mode | Status | Rules in one line |
| --- | --- | --- |
| **Pool Market** | live | Pari-mutuel: challengers share the creator stake proportionally; creator wins everything if right. Rewards contrarian conviction; prices crowd consensus. |
| **Duel / 1v1** | near-term | One creator, one challenger, matched stake, winner takes the two-person pot. `maxChallengers = 1`, "Accept Duel" CTA, rematch flow. |
| **Fixed Odds** | contract-ready | Creator guarantees a challenger return multiple backed by creator liquidity; predictable payout before joining. |
| **Underdog discovery** | product layer | Badges, sorting and upside previews for crowded-side contrarians. |
| **Rematch ladder** | partial (`parentId`) | Settled claim spawns the next round; social loop for rivalries. |
| **Streak scoring** | read-index first | Consecutive-win streaks surfaced on profiles before any contract change. |
| **Conviction mode** | future scoring layer | Scores how early and how strongly you backed a side, not just whether you were right. Kept transparent and secondary to actual payouts. |

Recommended rollout order: improve Pool Market legibility, ship Duel, harden Fixed Odds UI, add Underdog discovery, expand the Rematch Ladder, prototype Streak and Conviction as read-index features, then design true Squad vs Squad (which needs deeper contract accounting if both sides accept many deposits).

---

## Design principles

These show up in PR review and shape what we accept:

1. **Contract state is source of truth.** The Postgres read-index is a cache. If the two disagree, the chain wins; warm the cache from chain, never the other way.
2. **Agent keys stay in the worker.** Private keys live only in Railway/worker env (`ORACLE_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY`, `COUNCIL_*_PRIVATE_KEY`). The web server holds public addresses only. New agent writes go through `lib/agent-wallets.ts`. BYOA keys never leave the agent owner's infrastructure.
3. **Trust through process, not branding.** The settlement receipt shows the source, the evidence hash, the verdict, and the confidence. If a market can't be settled cleanly, it refunds: the protocol never fabricates certainty.
4. **Fees on profit only.** No fee schedule may be able to make a winner receive less than their principal, and refunds are always full.
5. **Narrow claims over expressive chaos.** The market-creator agent uses a 70/100 quality floor and a per-run cap so the surface stays sparse and actionable, not a firehose.
6. **Legibility over magic.** Every async path that takes more than ~5s (LLM call, contract receipt) surfaces progress in the UI or the worker logs.
7. **Refund the ambiguous.** `DRAW` and `UNRESOLVABLE` are first-class verdicts that return stakes. Better to be inconclusive and refund than to be wrong and pay out.

---

## License

MIT: see [`LICENSE`](./LICENSE).
