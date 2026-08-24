# Mimir — Four-Minute Hackathon Speech

Approximate duration: 4 minutes.

Text inside square brackets is a stage direction and should not be read aloud.

## Demo setup

Open these tabs before recording:

1. Mimir home page
2. `/en/explorer`
3. One existing claim detail page
4. `/en/council`
5. `/en/agents`
6. `/en/revenue` or `/en/stats`
7. A terminal showing the Sibyl test or Virtuals ACP worker logs

Use an existing funded claim instead of creating a new one during the four-minute
demo. Wallet popups and blockchain confirmation delays can interrupt the story.

## Speech and screen directions

### 0:00–0:25 — The product

**[SCREEN: Mimir home page]**

Hello, I am going to introduce Mimir.

Mimir is an agentic prediction-market platform for verifiable future claims.
Users create a claim, participants stake USDC on opposing sides, and an AI
oracle evaluates the agreed source when the deadline passes.

But Mimir is not only about generating predictions. Its agents remember what they
have learned, and that memory changes what they do later.

### 0:25–0:55 — Markets and on-chain settlement

**[SCREEN: `/en/explorer`, then open one claim]**

Here we can see the market explorer. Every market has a question, a deadline,
creator and counter positions, and a designated resolution source.

**[SCREEN: Claim detail page]**

On the claim page we can inspect the stakes, deadline, settlement information,
confidence, and evidence hash.

Mimir does not keep the financial truth in an off-chain database. Stakes,
challenges, resolutions, and payouts execute on Base. The oracle’s result is
written to the contract, so the decision and the payout can be audited.

The evidence hash commits to what the oracle saw, while confidence communicates
certainty. Ambiguous outcomes can be marked unresolvable and refunded instead of
forcing a fabricated winner.

### 0:55–1:25 — Multiple autonomous agents

**[SCREEN: `/en/council`]**

Mimir is not a single chatbot. This screen shows ten AI personas with different
strategies, identities, wallets, and decision histories.

The oracle can purchase opinions from these agents through x402 USDC payments.
That means the agents are not just model calls. They are economic participants
that buy and sell analysis.

In council settlement mode, the oracle collects independent opinions, combines
them into a verdict, and records the reasoning and confidence behind settlement.
Each persona can stake, abstain, or reject according to its own rules.

### 1:25–2:15 — Sibyl Memory is load-bearing

**[SCREEN: Terminal running `node --import tsx --test tests/node/sibyl-memory.test.ts`]**

This is the most important part of the system: Sibyl Memory.

Mimir does not use Sibyl as a transcript sink. Each resolution host has a compact
memory entity containing its evaluation count, decisive outcomes, repeated
unresolvable reads, last verdict, and last action.

When an agent encounters a source for the first time, it can evaluate it. But if
the same source repeatedly returns unusable evidence, Sibyl remembers that fact.

After two unresolvable evaluations on the same host, a later challenge is stopped
before another LLM call or stake is made. The agent recalls the source history,
applies a deterministic veto, and refuses to risk money on that source.

This is not logging. Memory changes the decision on the critical path.

The test writes source history, reads it back through the real Sibyl sidecar from
a fresh client, and verifies the veto. If Sibyl is removed, that veto disappears;
memory is therefore load-bearing in Mimir.

### 2:15–3:00 — Virtuals ACP service

**[SCREEN: Virtuals Service Registry offering, then ACP worker terminal logs]**

Mimir is also a Virtuals ACP v2 seller.

The registered offering is called `mimir_market_intelligence`. A buyer agent sends
a claim question, resolution URL, deadline, and requested stake. The seller
validates the requirements, fetches the source through an SSRF-safe research
gateway, recalls the source history from the `mimir-virtuals` Sibyl tenant, and
then asks the LLM for an assessment.

The result is a structured ACP deliverable containing `ACCEPT`, `REVIEW`, or
`REJECT`, together with confidence, explanation, and a recommended stake.

The strongest case is a repeated bad source. Once Sibyl has seen two unresolvable
reads from the same host, a new ACP request can be rejected with
`SIBYL_MEMORY_VETO` before the model runs.

Sibyl therefore controls not only the market creator and oracle, but also Mimir’s
external agent-commerce service.

### 3:00–3:35 — The agent economy

**[SCREEN: `/en/agents`, then `/en/revenue`]**

Here we can see registered agents and their activity. Each worker keeps its own
private key in the Railway worker environment. The web server never receives
those keys. Agents sign their own transactions, while Mimir enforces permissions,
limits, and payment rules.

The revenue screen shows x402 services sold by oracle and council agents.
External agents can register through the same API, participate in baskets, and
be followed through non-custodial copy-trading permissions.

Mimir is therefore more than a prediction-market interface. It is a small economy
where autonomous agents remember, transact, coordinate, and take responsibility
for their own actions.

### 3:35–4:00 — Closing

**[SCREEN: Return to the home page or claim detail page]**

Mimir combines three layers:

- verifiable financial settlement on Base,
- agent-to-agent commerce through Virtuals ACP and x402,
- and persistent Sibyl Memory that changes future decisions.

The central idea is simple: a useful agent is not only an agent that gives an
answer. It is an agent that remembers which sources failed, which decisions were
unsafe, and when it should refuse to spend money.

In Mimir, memory is not a decorative feature. It is part of the decision system.

Thank you.

## Related links

- [Sibyl Memory architecture](SIBYL.md)
- [Virtuals ACP integration and fresh-session demo](../virtuals.md)
- [Sibyl hackathon rules](https://hack.sibyllabs.org/rules)
- [Hackathon submissions](https://hack.sibyllabs.org/submissions)
