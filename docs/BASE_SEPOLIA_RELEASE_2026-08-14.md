# Base Sepolia MimirV2 release — 2026-08-14

## Deployment

- Network: Base Sepolia (`84532`)
- Contract: `MimirV2`
- Address: `0x2aE99017a17822f2514Fa26DCCBADE8F2D8beB13`
- Deployment transaction: `0x0286e6ed0f5a712d13b06fe499af6f82b314e40dd05234039a7c8c4fc1c8044e`
- Deployment block: `45476119`
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Platform fee: `0 bps`
- Agent-owner fee: `0 bps`

Explorer: https://sepolia.basescan.org/address/0x2aE99017a17822f2514Fa26DCCBADE8F2D8beB13

## Verification evidence

`npm run verify:deployment` confirmed:

- deployed runtime bytecode: `16,273` bytes;
- normalized runtime hash: `0xb1f83bef02710439ec6edba918ab397d5b172d5a3232b0b2023bc71c77760afc`;
- deployed runtime matches the locally compiled `MimirV2` runtime after immutable normalization;
- owner and oracle match the configured Oracle wallet;
- the immutable USDC address matches official Base Sepolia USDC.

The shared application ABI and every maintained create script use the deployed
`CreateParams` tuple, including the V2 `contextHash` and `agentOwnerRecipient`
fields.

## On-chain smoke evidence

`npm run smoke:onchain` completed a real USDC-backed flow on claim `#3`:

- create transaction: `0x19213047dffe0aa1a6fddf2ce6290954ea6e7fcbf288b8fcafd33e1b45a18c2f`;
- challenge transaction: `0x9d09bf3a6516a103d6c37966f718f5e7830668598581ea3a2a9fea43a42c4d04`;
- creator stake: `2 USDC`;
- challenger stake: `2 USDC`;
- final observed state: `ACTIVE`;
- challenger count: `1`.

The smoke runner derives the claim ID from the confirmed `ClaimCreated` event and
waits for dependent reads to become visible, avoiding transient stale reads from
public RPC replicas.
