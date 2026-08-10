import { readFileSync, writeFileSync } from "fs";

const path = "messages/en.json";
let s = readFileSync(path, "utf8");

const pairs: [string, string][] = [
  ["CLAIMS, SETTLED IN BOT.", "CLAIMS, SETTLED IN USDT."],
  [
    "Stand behind your claim Mimir settles it on-chain in BOT.",
    "Stand behind your claim — Mimir settles stakes on-chain in USDT.",
  ],
  ['"archiveColPool": "Pool (BOT)"', '"archiveColPool": "Pool (USDT)"'],
  ["Custom amount (BOT)", "Custom amount (USDT)"],
  ["Create & Fund {amount} BOT", "Create & Fund {amount} USDT"],
  ["Create Rematch & Fund {amount} BOT", "Create Rematch & Fund {amount} USDT"],
  ["Stake must be at least {amount} BOT", "Stake must be at least {amount} USDT"],
  ["Minimum stake is {amount} BOT.", "Minimum stake is {amount} USDT."],
  [
    "Current preview: {amount} BOT returned on a winning challenger bet.",
    "Current preview: {amount} USDT returned on a winning challenger bet.",
  ],
  ["Join & Stake {amount} BOT", "Join & Stake {amount} USDT"],
  [
    "Joined with {amount} BOT. Total pool now {total} BOT.",
    "Joined with {amount} USDT. Total pool now {total} USDT.",
  ],
  [
    "At the current fixed odds, a winning challenger bet returns {payout} BOT.",
    "At the current fixed odds, a winning challenger bet returns {payout} USDT.",
  ],
  ["Accept & Stake {amount} BOT", "Accept & Stake {amount} USDT"],
  ["Accepted — {amount} BOT at stake", "Accepted — {amount} USDT at stake"],
  ["{amount} BOT at risk", "{amount} USDT at risk"],
  [
    "You won this challenge. Credited: {amount} BOT.",
    "You won this challenge. Credited: {amount} USDT.",
  ],
  ['"stake": "20 BOT"', '"stake": "20 USDT"'],
  ['"winEstimate": "27 BOT"', '"winEstimate": "27 USDT"'],
  ['"stake": "12 BOT"', '"stake": "12 USDT"'],
  ['"winEstimate": "18 BOT"', '"winEstimate": "18 USDT"'],
  ['"stake": "35 BOT"', '"stake": "35 USDT"'],
  ['"winEstimate": "52 BOT"', '"winEstimate": "52 USDT"'],
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
