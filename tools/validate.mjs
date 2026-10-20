// Integrity checks for the knowledge base.
//   node tools/validate.mjs
// Exits non-zero on any failure, so it can gate a commit.

import fs from "node:fs";
import path from "node:path";
import { ROOT, BUILD, parseDocs, normPath, readJson } from "./lib.mjs";

const p = (...s) => path.join(ROOT, ...s);
const fails = [];
const warns = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);

const endpoints = readJson(p("data", "endpoints.json"));
const findings = readJson(p("data", "findings.json"));
const idMap = readJson(p("data", "id-map.json"));

// 1. endpoint IDs: unique, and in sync with the ledger
const ids = endpoints.endpoints.map((e) => e.id);
if (new Set(ids).size !== ids.length) fail("duplicate EP ids in data/endpoints.json");
for (const e of endpoints.endpoints) {
  const key = `${e.method} ${normPath(e.path)}`;
  if (idMap.ops[key] !== e.id) fail(`id ledger mismatch for ${key}: ${idMap.ops[key]} vs ${e.id}`);
}
const maxId = Math.max(...ids.map((i) => Number(i.slice(3))));
if (idMap._next <= maxId) fail(`id ledger _next (${idMap._next}) must exceed max id (${maxId})`);

// 2. drift between the generated data and the prose docs
const documented = new Set(parseDocs().map((o) => `${o.method} ${normPath(o.path)}`));
const recorded = new Set(endpoints.endpoints.map((e) => `${e.method} ${normPath(e.path)}`));
for (const k of recorded) if (!documented.has(k)) fail(`endpoint in JSON but not in docs: ${k}`);
for (const k of documented) if (!recorded.has(k)) fail(`endpoint in docs but not in JSON: ${k} (run build-kb)`);

// 3. build stamp consistency
const stamped = ["AGENTS.md", "index.json", "data/endpoints.json", "dist/context-pack.md"];
for (const f of stamped) {
  if (!fs.existsSync(p(f))) { fail(`missing ${f}`); continue; }
  if (!fs.readFileSync(p(f), "utf8").includes(BUILD)) fail(`${f} does not carry build ${BUILD}`);
}

// 4. findings: unique ids, present in the report
const fids = findings.findings.map((f) => f.id);
if (new Set(fids).size !== fids.length) fail("duplicate finding ids");
const report = fs.readFileSync(p("REPORT.md"), "utf8");
for (const id of fids) if (!report.includes(id)) fail(`finding ${id} missing from REPORT.md`);
for (const f of findings.findings) {
  if (!["critical", "high", "medium", "low", "low-medium", "info"].includes(f.severity)) {
    fail(`finding ${f.id} has invalid severity "${f.severity}"`);
  }
  if (!f.evidence || f.evidence.length === 0) fail(`finding ${f.id} has no evidence`);
}

// 5. secret scan (docs and generated data only; private/ is excluded)
const SECRET_PATTERNS = [
  [/ll_(?:session|pass|vid|dev)=[A-Za-z0-9+/=_-]{8,}/, "cookie value"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, "JWT"],
  [/"password"\s*:\s*"[^"]{4,}"/, "literal password"],
  [/\b[0-9a-f]{32,}\b/i, "long hex token"],
  [/[A-Za-z0-9._%+-]+@(?!lagoslife\.app)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
];
const scan = [...fs.readdirSync(ROOT).filter((f) => /\.(md|json)$/.test(f)).map((f) => [f, p(f)])];
for (const sub of ["data", "dist", "tools"]) {
  for (const f of fs.readdirSync(p(sub)).filter((f) => /\.(md|json|mjs)$/.test(f))) scan.push([`${sub}/${f}`, p(sub, f)]);
}
for (const [name, file] of scan) {
  const text = fs.readFileSync(file, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) fail(`possible ${label} in ${name}: ${m[0].slice(0, 12)}…`);
  }
}

// 6. local markdown links resolve
for (const [name, file] of scan.filter(([n]) => n.endsWith(".md"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) fail(`broken link in ${name}: ${m[1]}`);
  }
}

// 7. context pack must stay small enough to paste
const pack = fs.statSync(p("dist", "context-pack.md")).size;
if (pack > 40_000) warn(`context pack is ${Math.round(pack / 1024)} KB — consider trimming`);
if (!endpoints.counts || endpoints.counts.endpoints !== endpoints.endpoints.length) fail("counts block is stale");

// report
console.log(`endpoints: ${endpoints.endpoints.length} (${endpoints.counts.observed} observed, ${endpoints.counts.static_only} static-only)`);
console.log(`findings:  ${findings.findings.length}`);
console.log(`pack:      ${pack} bytes (~${Math.ceil(pack / 4)} tokens)`);
for (const w of warns) console.log("WARN  " + w);
for (const f of fails) console.log("FAIL  " + f);
console.log(fails.length ? `\n${fails.length} failure(s)` : "\nOK — knowledge base is consistent");
process.exit(fails.length ? 1 : 0);
