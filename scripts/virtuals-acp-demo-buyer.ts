import {
  AcpAgent,
  PrivyAlchemyEvmProviderAdapter,
  type JobRoomEntry,
  type JobSession,
} from "@virtuals-protocol/acp-node-v2";
import {
  DEFAULT_OFFERING_NAME,
  optionalVirtualsEnv,
  requireVirtualsEnv,
  shortAddress,
  virtualsChain,
} from "../agents/virtuals/acp-config";

const chain = virtualsChain();
const offeringName = process.env.VIRTUALS_ACP_OFFERING_NAME?.trim() || DEFAULT_OFFERING_NAME;

function requirement(): Record<string, unknown> {
  const raw = process.env.VIRTUALS_ACP_REQUIREMENT_JSON?.trim();
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("VIRTUALS_ACP_REQUIREMENT_JSON must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  return {
    claimQuestion: process.env.VIRTUALS_ACP_DEMO_QUESTION ?? "Will the cited source support this claim by the deadline?",
    resolutionUrl: process.env.VIRTUALS_ACP_DEMO_URL ?? "https://example.invalid/mimir-demo-source",
    deadline: process.env.VIRTUALS_ACP_DEMO_DEADLINE ?? new Date(Date.now() + 86_400_000).toISOString(),
    requestedStakeUsdc: Number(process.env.VIRTUALS_ACP_DEMO_STAKE_USDC ?? "2"),
    creatorPosition: "The claim is supported by the source",
    counterPosition: "The claim is not supported by the source",
  };
}

async function main(): Promise<void> {
  const buyer = await AcpAgent.create({
    evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: requireVirtualsEnv("VIRTUALS_ACP_BUYER_WALLET_ADDRESS") as `0x${string}`,
      walletId: requireVirtualsEnv("VIRTUALS_ACP_BUYER_WALLET_ID"),
      signerPrivateKey: requireVirtualsEnv("VIRTUALS_ACP_BUYER_SIGNER_PRIVATE_KEY"),
      chains: [chain],
      builderCode: optionalVirtualsEnv("VIRTUALS_ACP_BUYER_BUILDER_CODE"),
      serverUrl: optionalVirtualsEnv("VIRTUALS_ACP_SERVER_URL"),
    }),
  });
  const buyerAddress = (await buyer.getAddress()).toLowerCase();
  const sellerAddress = requireVirtualsEnv("VIRTUALS_ACP_SELLER_WALLET_ADDRESS").toLowerCase();
  const seller = await buyer.getAgentByWalletAddress(sellerAddress);
  const offering = seller?.offerings.find((item) => item.name === offeringName);
  if (!seller || !offering) {
    throw new Error(`Seller ${sellerAddress} does not expose offering '${offeringName}'`);
  }

  let finished = false;
  let finish!: (result: "completed" | "rejected" | "expired") => void;
  const done = new Promise<"completed" | "rejected" | "expired">((resolve) => {
    finish = resolve;
  });

  buyer.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (entry.kind !== "system") return;
    if (entry.event.type === "job.created") {
      console.log(`[virtuals-acp-demo] job ${session.jobId} created`);
    } else if (entry.event.type === "budget.set" && session.status === "budget_set") {
      await session.fund();
      console.log(`[virtuals-acp-demo] job ${session.jobId} funded`);
    } else if (entry.event.type === "job.submitted" && session.status === "submitted") {
      console.log(`[virtuals-acp-demo] deliverable received: ${entry.event.deliverable}`);
      await session.complete("Demo buyer accepted the structured Mimir assessment");
    } else if (entry.event.type === "job.completed" && !finished) {
      finished = true;
      console.log(`[virtuals-acp-demo] job ${session.jobId} completed`);
      finish("completed");
    } else if (entry.event.type === "job.rejected" && !finished) {
      finished = true;
      console.log(`[virtuals-acp-demo] job ${session.jobId} rejected: ${entry.event.reason}`);
      finish("rejected");
    } else if (entry.event.type === "job.expired" && !finished) {
      finished = true;
      finish("expired");
    }
  });

  await buyer.start(() => console.log(`[virtuals-acp-demo] buyer ${shortAddress(buyerAddress)} connected`));
  const jobId = await buyer.createJobFromOffering(
    chain.id,
    offering,
    sellerAddress,
    requirement(),
    { evaluatorAddress: buyerAddress },
  );
  console.log(`[virtuals-acp-demo] created ACP job ${jobId} on ${chain.name} (${chain.id})`);
  const result = await done;
  await buyer.stop();
  if (result !== "completed") process.exitCode = 1;
}

main().catch((err) => {
  console.error("[virtuals-acp-demo] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
