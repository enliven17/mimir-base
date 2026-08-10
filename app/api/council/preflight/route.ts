/**
 * Council preflight, pay-per-read.
 *
 * POST /api/council/preflight?persona=optimist   ($0.001 USDC / read)
 *
 * The market-creator buys persona opinions before opening a market. This is
 * different from /api/council/vote: preflight judges whether a candidate is
 * worth creating, while vote judges an already-created claim at settlement.
 */

import { NextResponse, type NextRequest } from "next/server";
import { paidRoute, queryParam } from "@/lib/x402/server";
import type { HTTPRequestContext } from "@x402/core/http";
import { PRICES } from "@/lib/x402/config";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { getCouncilAddress } from "@/lib/agent-wallets";
import { callLLM } from "@/lib/llm";

interface CandidatePayload {
  question?: string;
  creatorPosition?: string;
  counterPosition?: string;
  resolutionUrl?: string;
  category?: string;
  settlementRule?: string;
  deadlineHours?: number;
  qualityScore?: number;
}

/** Recipient of this opinion's fee — the persona itself, not the platform. */
function personaAddress(ctx: HTTPRequestContext): string {
  const slug = queryParam(ctx, "persona").toLowerCase().trim();
  const payTo = getCouncilAddress(slug);
  if (!payTo) throw new Error(`persona '${slug}' has no wallet configured`);
  return payTo;
}

function cleanCandidate(value: unknown): CandidatePayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const question = String(raw.question ?? "").trim();
  const creatorPosition = String(raw.creatorPosition ?? "").trim();
  const counterPosition = String(raw.counterPosition ?? "").trim();
  const resolutionUrl = String(raw.resolutionUrl ?? "").trim();
  const category = String(raw.category ?? "").trim();
  const settlementRule = String(raw.settlementRule ?? "").trim();
  const deadlineHours = Number(raw.deadlineHours ?? 0);
  const qualityScore = Number(raw.qualityScore ?? 0);

  if (!question || !creatorPosition || !counterPosition || !resolutionUrl) {
    return null;
  }

  return {
    question: question.slice(0, 500),
    creatorPosition: creatorPosition.slice(0, 300),
    counterPosition: counterPosition.slice(0, 300),
    resolutionUrl: resolutionUrl.slice(0, 600),
    category: category.slice(0, 80),
    settlementRule: settlementRule.slice(0, 700),
    deadlineHours: Number.isFinite(deadlineHours) ? deadlineHours : 0,
    qualityScore: Number.isFinite(qualityScore) ? qualityScore : 0,
  };
}

function parseModelJson(text: string): {
  decision: "open" | "revise" | "skip";
  score: number;
  confidence: number;
  reasoning: string;
} {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as Record<string, unknown>;
    const rawDecision = String(parsed.decision ?? "").toLowerCase();
    const decision =
      rawDecision === "open" || rawDecision === "revise" || rawDecision === "skip"
        ? rawDecision
        : "revise";
    return {
      decision,
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 50)))),
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 50)))),
      reasoning: String(parsed.reasoning ?? "").slice(0, 400),
    };
  } catch {
    return {
      decision: "revise",
      score: 50,
      confidence: 30,
      reasoning: "(persona response could not be parsed)",
    };
  }
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const slug = (req.nextUrl.searchParams.get("persona") ?? "").toLowerCase().trim();

  const persona = COUNCIL_PERSONAS.find((p) => p.slug === slug);
  if (!persona) return NextResponse.json({ error: `unknown persona '${slug}'` }, { status: 400 });

  const payTo = getCouncilAddress(slug);
  if (!payTo) {
    return NextResponse.json({ error: `persona '${slug}' has no wallet configured` }, { status: 503 });
  }

  let candidate: CandidatePayload | null = null;
  try {
    candidate = cleanCandidate(await req.json());
  } catch {
    candidate = null;
  }
  if (!candidate) {
    return NextResponse.json({ error: "candidate payload is required" }, { status: 400 });
  }

  const category = candidate.category?.toLowerCase() ?? "";
  if (
    persona.categoryFilter &&
    !persona.categoryFilter.some((c) => c.toLowerCase() === category)
  ) {
    return NextResponse.json({
      persona: { slug, name: persona.displayName, emoji: persona.emoji },
      decision: "skip",
      score: 30,
      confidence: 80,
      reasoning: `${persona.displayName} skips ${category || "uncategorized"} markets outside its domain.`,
      paidTo: payTo,
      price: PRICES.councilPreflight,
    });
  }

  const personaFrame =
    persona.promptBias ??
    `You are ${persona.displayName} on the Mimir Council. ${persona.longBio}`;
  const prompt = `${personaFrame}

You are being paid for a pre-market opinion before Mimir opens this candidate.

Candidate:
- Question: ${candidate.question}
- Creator side: ${candidate.creatorPosition}
- Challenger side: ${candidate.counterPosition}
- Category: ${candidate.category || "custom"}
- Resolution URL: ${candidate.resolutionUrl}
- Settlement rule: ${candidate.settlementRule || "(none)"}
- Deadline hours from now: ${candidate.deadlineHours}
- Draft quality score: ${candidate.qualityScore}

Return JSON only:
{
  "decision": "open" | "revise" | "skip",
  "score": 0-100,
  "confidence": 0-100,
  "reasoning": "one tight sentence, max 45 words"
}

Score the candidate as a market to create, not as a final outcome. Favor clear, verifiable, balanced markets. Penalize vague rules, weak sources, stale outcomes, or one-sided framing. Stay in character.`;

  let result: ReturnType<typeof parseModelJson>;
  try {
    result = parseModelJson(await callLLM(prompt, { maxTokens: 260, jsonOnly: true }));
  } catch {
    result = {
      decision: "revise",
      score: 50,
      confidence: 20,
      reasoning: "(reasoning unavailable right now)",
    };
  }

  return NextResponse.json({
    persona: { slug, name: persona.displayName, emoji: persona.emoji },
    ...result,
    paidTo: payTo,
    price: PRICES.councilPreflight,
  });
}

// Dynamic payTo: each persona is paid into its own wallet.
export const POST = paidRoute("councilPreflight", handler, { payTo: personaAddress });
