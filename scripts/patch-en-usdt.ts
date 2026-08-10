import { readFileSync, writeFileSync } from "fs";

const path = "messages/en.json";
let s = readFileSync(path, "utf8");

const pairs: [string, string][] = [
  ["CLAIMS, SETTLED IN BOT.", "CLAIMS, SETTLED IN USDC."],
  [
    "Stand behind your claim Mimir settles it on-chain in BOT.",
    "Stand behind your claim — Mimir settles stakes on-chain in USDC.",
  ],
  ['"archiveColPool": "Pool (BOT)"', '"archiveColPool": "Pool (USDC)"'],
  ["Custom amount (BOT)", "Custom amount (USDC)"],
  ["Create & Fund {amount} BOT", "Create & Fund {amount} USDC"],
  ["Create Rematch & Fund {amount} BOT", "Create Rematch & Fund {amount} USDC"],
  ["Stake must be at least {amount} BOT", "Stake must be at least {amount} USDC"],
  ["Minimum stake is {amount} BOT.", "Minimum stake is {amount} USDC."],
  [
    "Current preview: {amount} BOT returned on a winning challenger bet.",
    "Current preview: {amount} USDC returned on a winning challenger bet.",
  ],
  ["Join & Stake {amount} BOT", "Join & Stake {amount} USDC"],
  [
    "Joined with {amount} BOT. Total pool now {total} BOT.",
    "Joined with {amount} USDC. Total pool now {total} USDC.",
  ],
  [
    "At the current fixed odds, a winning challenger bet returns {payout} BOT.",
    "At the current fixed odds, a winning challenger bet returns {payout} USDC.",
  ],
  ["Accept & Stake {amount} BOT", "Accept & Stake {amount} USDC"],
  ["Accepted — {amount} BOT at stake", "Accepted — {amount} USDC at stake"],
  ["{amount} BOT at risk", "{amount} USDC at risk"],
  [
    "You won this challenge. Credited: {amount} BOT.",
    "You won this challenge. Credited: {amount} USDC.",
  ],
  ['"stake": "20 BOT"', '"stake": "20 USDC"'],
  ['"winEstimate": "27 BOT"', '"winEstimate": "27 USDC"'],
  ['"stake": "12 BOT"', '"stake": "12 USDC"'],
  ['"winEstimate": "18 BOT"', '"winEstimate": "18 USDC"'],
  ['"stake": "35 BOT"', '"stake": "35 USDC"'],
  ['"winEstimate": "52 BOT"', '"winEstimate": "52 USDC"'],
];

let n = 0;
for (const [a, b] of pairs) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    n++;
  } else {
    console.log("MISS:", a.slice(0, 70));
  }
}
JSON.parse(s);
writeFileSync(path, s);
console.log("replaced", n, "patterns; json ok");
