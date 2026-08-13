# Clean-state Base Sepolia redeploy

Compile and run all contract/security tests, deploy a fresh contract (never upgrade or reinterpret old escrow), then run `MIMIR_CONTRACT_NAME=MimirV2 npm run verify:deployment` (set the environment variable with PowerShell syntax on Windows). Verification recompiles with the release settings, masks constructor immutables, and requires the normalized runtime bytecode hash plus owner/oracle/USDC reads to match. Record chain ID 84532, contract address, deploy block, transaction hash, compiler version, normalized runtime hash, owner, oracle and USDC in the release evidence.

Start a new read-index cursor at the new deploy block. Old-network or old-contract rows stay in their historical database/export and are never conditionally merged into the Base Sepolia branch. Rebuild the new index solely from the new address's events, fund test actors, and execute `npm run smoke:onchain` plus resolve/refund/withdraw smoke cases before workers are enabled. Keep the command output and explorer links as release evidence.

Rollback means disabling create/stake and returning to the prior UI configuration; it never means mutating or deleting either contract's financial state.
