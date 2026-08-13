# Clean-state Base Sepolia redeploy

Compile and run all contract/security tests, then deploy a fresh contract with `MIMIR_CONTRACT_NAME=MimirV2`, explicit `PLATFORM_FEE_BPS`, `AGENT_OWNER_FEE_BPS` and `PLATFORM_FEE_RECIPIENT` values (never upgrade or reinterpret old escrow). Run `npm run deploy:contract`, then `npm run verify:deployment` with the same contract-name setting; use PowerShell environment-variable syntax on Windows. Verification recompiles with the release settings, masks constructor immutables, and requires the normalized runtime bytecode hash plus owner/oracle/USDC reads to match. Record chain ID 84532, contract address, deploy block, transaction hash, compiler version, normalized runtime hash, owner, oracle, USDC and fee policy in the release evidence.

Start a new read-index cursor at the new deploy block. Old-network or old-contract rows stay in their historical database/export and are never conditionally merged into the Base Sepolia branch. Rebuild the new index solely from the new address's events, fund test actors, and execute `npm run smoke:onchain` plus resolve/refund/withdraw smoke cases before workers are enabled. Keep the command output and explorer links as release evidence.

Rollback means disabling create/stake and returning to the prior UI configuration; it never means mutating or deleting either contract's financial state.
