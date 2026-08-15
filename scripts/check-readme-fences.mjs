// ponytail: one-shot README sanity check; safe to delete.
import { readFileSync } from "node:fs";

const s = readFileSync("README.md", "utf8");
const fence = "```";
const lines = s.split("\n");
let open = null;
let blocks = 0;
for (const [i, line] of lines.entries()) {
  if (!line.trimStart().startsWith(fence)) continue;
  if (open === null) {
    open = line.trim().slice(3);
    blocks++;
  } else if (line.trim() === fence) {
    open = null;
  } else {
    console.log(`line ${i + 1}: suspicious fence inside ${open} block: ${line}`);
  }
}
console.log("code blocks:", blocks);
console.log("balanced:", open === null);
const mermaid = lines.filter((l) => l.trim() === "```mermaid").length;
console.log("mermaid blocks:", mermaid);
