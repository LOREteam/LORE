import { readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const root = realpathSync(process.cwd());
const apply = process.argv.includes("--apply");
const candidatePattern = /^\.next-candidate(?:-[a-z0-9-]+)?$/i;

const candidates = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && candidatePattern.test(entry.name))
  .map((entry) => ({ name: entry.name, path: join(root, entry.name) }));

for (const candidate of candidates) {
  if (dirname(candidate.path) !== root) throw new Error("unsafe Next candidate cleanup target");
  if (apply) rmSync(candidate.path, { recursive: true, force: true });
}

console.log(JSON.stringify({
  mode: apply ? "applied" : "dry-run",
  count: candidates.length,
  candidates: candidates.map((candidate) => candidate.name),
}));
