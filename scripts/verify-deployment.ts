import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia, getBaseRpcUrl } from "../lib/base";
import { USDC_ADDRESS } from "../lib/usdc";

const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined;
if (!address) throw new Error("NEXT_PUBLIC_CONTRACT_ADDRESS is required");
const client = createPublicClient({ chain: baseSepolia, transport: http(getBaseRpcUrl()) });
const chainId = await client.getChainId();
if (chainId !== baseSepolia.id) throw new Error(`wrong chain ${chainId}`);
const code = await client.getCode({ address });
if (!code || code === "0x") throw new Error("deployment has no bytecode");
const abi = parseAbi(["function owner() view returns (address)", "function oracle() view returns (address)", "function usdc() view returns (address)"]);
const [owner, oracle, usdc] = await Promise.all([
  client.readContract({ address, abi, functionName: "owner" }),
  client.readContract({ address, abi, functionName: "oracle" }),
  client.readContract({ address, abi, functionName: "usdc" }),
]);
if (usdc.toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new Error(`unexpected USDC ${usdc}`);
console.log(JSON.stringify({ chainId, address, bytecodeBytes: (code.length - 2) / 2, owner, oracle, usdc }, null, 2));
