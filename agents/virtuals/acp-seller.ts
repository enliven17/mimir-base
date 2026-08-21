import {
  AcpAgent,
  AssetToken,
  PrivyAlchemyEvmProviderAdapter,
  type AcpAgentOffering,
  type JobRoomEntry,
  type JobSession,
} from "@virtuals-protocol/acp-node-v2";
import {
  assessAcpRequest,
  parseAcpRequirement,
  type AcpAssessment,
  type AcpRequirement,
} from "./acp-assessment";
import {
  DEFAULT_OFFERING_NAME,
  optionalVirtualsEnv,
  requireVirtualsEnv,
  shortAddress,
  virtualsChain,
} from "./acp-config";
import { ensureSibyl } from "../../lib/sibyl/memory";

const OFFERING_NAME = process.env.VIRTUALS_ACP_OFFERING_NAME?.trim() || DEFAULT_OFFERING_NAME;
const chain = virtualsChain();
const decisions = new Map<string, AcpAssessment>();

function sessionKey(session: JobSession): string {
  return `${session.chainId}:${session.jobId}`;
}

function log(message: string): void {
  console.log(`[virtuals-acp] ${message}`);
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 20_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseRequirementEntry(session: JobSession): AcpRequirement {
  const entry = [...session.entries]
    .reverse()
    .find((candidate) => candidate.kind === "message" && candidate.contentType === "requirement");
  if (!entry || entry.kind !== "message") throw new Error("No ACP requirement message found");
  return parseAcpRequirement(JSON.parse(entry.content));
}

async function assessmentFor(session: JobSession): Promise<AcpAssessment> {
  const key = sessionKey(session);
  const existing = decisions.get(key);
  if (existing) return existing;
  const assessment = await assessAcpRequest({
    request: parseRequirementEntry(session),
    jobId: session.jobId,
  });
  decisions.set(key, assessment);
  return assessment;
}

async function rejectWithDetail(session: JobSession, tag: string, detail: string): Promise<void> {
  log(`[job ${session.jobId}] rejecting: ${detail}`);
  try {
    await session.sendMessage(detail, "text");
    await session.reject(tag);
  } catch (err) {
    console.error(`[virtuals-acp] [job ${session.jobId}] reject failed`, err);
  }
}

function configuredOffering(offerings: AcpAgentOffering[]): AcpAgentOffering | undefined {
  return offerings.find((offering) => offering.name === OFFERING_NAME && !offering.isHidden);
}

async function main(): Promise<void> {
  log("starting; checking Sibyl Memory");
  await ensureSibyl();
  log("Sibyl Memory healthy; creating Virtuals provider");
  const evmProvider = await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress: requireVirtualsEnv("VIRTUALS_ACP_SELLER_WALLET_ADDRESS") as `0x${string}`,
    walletId: requireVirtualsEnv("VIRTUALS_ACP_SELLER_WALLET_ID"),
    signerPrivateKey: requireVirtualsEnv("VIRTUALS_ACP_SELLER_SIGNER_PRIVATE_KEY"),
    chains: [chain],
    builderCode: optionalVirtualsEnv("VIRTUALS_ACP_SELLER_BUILDER_CODE"),
    serverUrl: optionalVirtualsEnv("VIRTUALS_ACP_SERVER_URL"),
  });
  log("Virtuals provider created; creating ACP agent");
  const seller = await AcpAgent.create({
    evmProvider,
  });

  log("ACP agent created; loading Virtuals Service Registry profile");
  const sellerAddress = (await seller.getAddress()).toLowerCase();
  const profile = await withTimeout(
    seller.getAgentByWalletAddress(sellerAddress),
    "Virtuals Service Registry lookup",
  );
  const offering = configuredOffering(profile?.offerings ?? []);
  if (!offering) {
    throw new Error(
      `Offering '${OFFERING_NAME}' was not found for ${sellerAddress}. Register it in the Virtuals Service Registry first.`,
    );
  }

  log(`seller ${shortAddress(sellerAddress)} on ${chain.name} (${chain.id})`);
  log(`offering '${offering.name}' · ${offering.priceValue} USDC · SLA ${offering.slaMinutes} min`);
  log("Sibyl Memory healthy; listening for ACP jobs");

  seller.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    try {
      if (entry.kind === "system") {
        if (entry.event.type === "job.created") {
          log(`[job ${session.jobId}] received from ${shortAddress(entry.event.client)}`);
        }

        if (entry.event.type === "job.funded" && session.status === "funded") {
          const assessment = await assessmentFor(session);
          if (assessment.terminalReject) {
            await rejectWithDetail(session, "SIBYL_MEMORY_VETO", assessment.explanation);
            return;
          }
          const deliverable = JSON.stringify({
            type: "mimir.acp.market-intelligence",
            ...assessment,
            jobId: session.jobId,
            chainId: session.chainId,
            evaluatedAt: new Date().toISOString(),
          });
          await session.submit(deliverable);
          log(`[job ${session.jobId}] submitted ${assessment.decision} (${assessment.confidence}%)`);
        }

        if (entry.event.type === "job.completed") {
          log(`[job ${session.jobId}] completed`);
          decisions.delete(sessionKey(session));
        }
        if (entry.event.type === "job.rejected" || entry.event.type === "job.expired") {
          decisions.delete(sessionKey(session));
        }
      }

      if (
        entry.kind === "message" &&
        entry.contentType === "requirement" &&
        session.status === "open"
      ) {
        if (session.job?.description !== OFFERING_NAME) {
          await rejectWithDetail(session, "UNSUPPORTED_OFFERING", `This seller only serves '${OFFERING_NAME}'.`);
          return;
        }
        let assessment: AcpAssessment;
        try {
          assessment = await assessmentFor(session);
        } catch (err) {
          await rejectWithDetail(
            session,
            "INVALID_OR_UNAVAILABLE_REQUEST",
            `Mimir could not safely assess this request: ${err instanceof Error ? err.message : "unknown error"}`,
          );
          return;
        }
        if (assessment.terminalReject) {
          await rejectWithDetail(session, "SIBYL_MEMORY_VETO", assessment.explanation);
          return;
        }
        await session.sendMessage(JSON.stringify(assessment), "structured");
        await session.setBudget(AssetToken.usdc(offering.priceValue, session.chainId));
        log(`[job ${session.jobId}] budget set; waiting for funding`);
      }
    } catch (err) {
      console.error(`[virtuals-acp] [job ${session.jobId}] handler failed`, err);
      if (session.status === "open" || session.status === "budget_set" || session.status === "funded") {
        await rejectWithDetail(session, "SELLER_ERROR", "Mimir could not complete this request safely.");
      }
    }
  });

  await seller.start(() => log("ACP transport connected"));

  const shutdown = async (signal: NodeJS.Signals) => {
    log(`received ${signal}; shutting down`);
    await seller.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[virtuals-acp] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
