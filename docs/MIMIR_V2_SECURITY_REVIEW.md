# MimirV2 security review

Date: 2026-08-12

## Automated checks

- Solidity 0.8.28 compilation with optimizer and `viaIR`: clean, 17,130 bytes.
- Slither 0.11.x: 102 detectors executed against `contracts/MimirV2.sol`.
- Deterministic fee fuzz suite: 2,000 generated settlements plus golden Pool,
  Duel, Fixed Odds, refund, dust and recipient-merging cases.
- Source guards cover fee-on-transfer rejection, checks-effects-interactions,
  `nonReentrant`, and pull-based fee accrual.

## Slither triage

The review fixed actionable findings: oracle zero-address validation, ownership
events, indexed fee-recipient events, exact compiler pinning, and the unnecessary
payable receiver.

Remaining reports are expected design properties:

- Token calls are reported as reentrancy candidates. Every mutating entry point
  involved is protected by the same `nonReentrant` guard. The configured token is
  immutable Circle USDC, and exact balance-delta validation rejects unsupported
  transfer semantics.
- Strict balance equality is intentional: accepting a smaller or larger delta
  would make escrow accounting incorrect.
- The low-level payout call intentionally converts a failed USDC transfer into a
  pullable `pendingWithdrawals` balance so one blacklisted recipient cannot block
  all settlement recipients.
- Timestamp comparisons implement deadlines and the fee-policy timelock.
- Fee accrual writes occur in a loop bounded by `MAX_CHALLENGERS`; the deployment
  and gas limits must retain that bound.
- Zero-initialized `paid` and `fees` accumulators use Solidity's defined default
  initialization.

## Operational requirement

Deployment must pass the official Circle USDC address for the target Base network.
The deploy script and environment validation are the configuration boundary; the
contract additionally proves each stake transfer changes escrow by the exact
requested atomic amount.
