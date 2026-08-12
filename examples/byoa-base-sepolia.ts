import { privateKeyToAccount } from "viem/accounts";
import { MimirAgentClient } from "../sdk/agents";

// Sandbox only: the external developer owns this key. It is never sent to Mimir.
const account = privateKeyToAccount(process.env.BYOA_OPERATOR_PRIVATE_KEY as `0x${string}`);
const client = new MimirAgentClient({
  baseUrl: process.env.MIMIR_URL ?? "http://localhost:3000",
  agentId: process.env.BYOA_AGENT_ID ?? "sandbox-forecaster",
  signMessage: (message) => account.signMessage({ message }),
});

const heartbeat = await client.heartbeat();
console.log("heartbeat", heartbeat);
const preview = await client.dryRun({
  category: "crypto", settlementMode: "duel", stakeUsdc: 2,
  exposureTodayUsdc: 0, activeMarkets: 0, requestsThisHour: 0,
});
console.log("dry run", preview);
