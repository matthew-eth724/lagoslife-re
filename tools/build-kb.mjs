// Generates the machine-readable layer of the knowledge base.
//   node tools/build-kb.mjs
// Outputs: data/endpoints.json, data/state-keys.json, index.json, dist/context-pack.md
//
// Endpoint IDs are assigned once and preserved in data/id-map.json, so adding a
// new endpoint never renumbers the existing ones.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ROOT, BUILD, CAPTURED, parseDocs, parseStatic, parseHar, normPath,
  groupOf, readJson, writeJson, tokens,
} from "./lib.mjs";

const p = (...s) => path.join(ROOT, ...s);

/** Endpoints confirmed by a direct live probe (not present in a capture). */
const PROBES = new Set([
  "GET /api/version",
  "GET /api/auth/me",
  "GET /api/captcha",
  "GET /api/daily",
  "GET /api/players",
  "GET /api/go",
]);

/** Operations confirmed from shipped code that does not go through the SDK wrapper. */
const STATIC_EXTRA = new Set(["POST /api/client-error"]);

/** Human/agent notes and flags for operations that carry risk or nuance. */
const OVERLAY = {
  "GET /api/auth/me": { public: true, note: "200 with {user:null} when logged out, not 401. Exposes `user.admin`." },
  "POST /api/auth/login": { public: true, note: "404 {code:'no_user'} for unknown handle — username enumeration (F-01)." },
  "POST /api/auth/register": { public: true, note: "Turnstile-gated; captcha token required." },
  "GET /api/captcha": { public: true, note: "Returns the public Turnstile site key." },
  "GET /api/version": { public: true, note: "Build stamp used for staleness checks." },
  "GET /api/daily": { public: true, note: "Daily headline/weather; no auth required." },
  "GET /api/players": { public: false, note: "401 {'Please log in'} without a session." },
  "PUT /api/save": {
    note: "Client-authoritative snapshot: {game, owner, base, build}. `base` detects concurrency, not plausibility (F-02).",
    validation: "unverified",
  },
  "GET /api/save": { note: "Returns {game, updatedAt, now}; `game` has 133 top-level keys." },
  "POST /api/levels": { note: "Client submits {op, xp}. Server did not blindly add it (16→30 on xp:26), but value is still client-originated (F-04).", validation: "unverified" },
  "POST /api/send": { note: "Money transfer; response carries `fee`. PIN may be required (F-03: float currency)." },
  "POST /api/messages": { note: "`cid` is a client idempotency key — retries apply once." },
  "GET /api/bail": { note: "Own bail status (bailMine); `?friends=1` lists friends who could post bail." },
  "POST /api/bail": { note: "Three variants by `action`: ask {to, amount}, pay {id}, visit {to, item?}." },
  "GET /api/wallet/verify": { note: "Mutating GET: verifies a checkout. Reachable cross-site via top-level navigation under SameSite=Lax." },
  "GET /api/ads/verify": { note: "Mutating GET: verifies an ad checkout. Same caveat as wallet/verify." },
  "POST /api/world": { note: "Presence beacon; response carries feature flags (cities, refinery, risk, econ, pol, tl, give, cred, soc, chd, homeExt)." },
  "POST /api/client-error": { public: true, note: "sendBeacon telemetry: {message, stack, where, url, uid, screen, build}." },
  "GET /api/go": { public: true, note: "Referral redirect; returns an HTML page, not JSON." },
};

export function build() {
  const docs = parseDocs();
  const sdk = parseStatic();
  const har = parseHar();

  // A clone has no captures (private/ is gitignored). Rebuilding would silently
  // downgrade every observed endpoint to static-only, so refuse unless told to.
  if (har.size === 0 && fs.existsSync(p("data", "endpoints.json")) &&
      !process.argv.includes("--allow-no-har")) {
    console.error(
      "No captures found in private/. Refusing to rebuild — it would downgrade\n" +
      "observed endpoints to static-only. Use --allow-no-har to rebuild from docs alone.",
    );
    process.exit(2);
  }

  const idMapPath = p("data", "id-map.json");
  const idMap = fs.existsSync(idMapPath)
    ? readJson(idMapPath)
    : { _next: 1, ops: {} };

  const endpoints = docs.map((op) => {
    const key = `${op.method} ${normPath(op.path)}`;
    if (!idMap.ops[key]) {
      idMap.ops[key] = "EP-" + String(idMap._next++).padStart(3, "0");
    }
    const seen = har.get(key);
    const staticPath = sdk.get(normPath(op.path));
    const probed = PROBES.has(key);
    const staticExtra = STATIC_EXTRA.has(key);
    const sources = [];
    if (seen) sources.push(...seen.sources);
    if (probed) sources.push("live-probe");
    if (staticPath) sources.push("static");
    if (staticExtra) sources.push("static:boot");
    if (sources.length === 0) sources.push("doc");

    const confidence =
      seen || probed ? "confirmed-live" : staticPath || staticExtra ? "static-only" : "doc-only";
    const overlay = OVERLAY[key] || {};

    return {
      id: idMap.ops[key],
      method: op.method,
      path: op.path,
      query: op.query,
      group: groupOf(op.path),
      auth: overlay.public ? "none" : "session",
      mutating: op.method !== "GET" || /\/verify$/.test(op.path),
      confidence,
      validation: overlay.validation || (op.method === "GET" ? "n/a" : "unverified"),
      observed_status: seen ? [...seen.statuses].sort((a, b) => a - b) : [],
      sources: [...new Set(sources)],
      in_sdk: Boolean(staticPath),
      note: overlay.note || "",
    };
  });

  endpoints.sort((a, b) =>
    a.group.localeCompare(b.group) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  writeJson(p("data", "id-map.json"), idMap);
  writeJson(p("data", "endpoints.json"), {
    meta: {
      game: "lagoslife.app",
      build: BUILD,
      captured: CAPTURED,
      generated_by: "tools/build-kb.mjs",
      note: "Machine-readable view. Prose, bodies and reasoning live in API-REFERENCE.md. Regenerate, never hand-edit.",
    },
    counts: {
      endpoints: endpoints.length,
      paths: new Set(endpoints.map((e) => e.path)).size,
      observed: endpoints.filter((e) => e.confidence === "confirmed-live").length,
      static_only: endpoints.filter((e) => e.confidence === "static-only").length,
      doc_only: endpoints.filter((e) => e.confidence === "doc-only").length,
    },
    endpoints,
  });

  // ---- game state keys (types only, never values) ----
  const stateFile = p("data", "state-keys.json");
  const gameKeys = extractStateKeys();
  if (gameKeys) writeJson(stateFile, gameKeys);

  // ---- manifest ----
  const docsMeta = [
    ["AGENTS.md", "entry", "Agent entry contract and routing table", "every session", "build stamp changes"],
    ["index.json", "manifest", "Machine-readable map of this knowledge base", "to plan what to read", "any file changes"],
    ["REPORT.md", "report", "Full analysis: methodology, architecture, findings, recommendations", "security review or writing a summary", "build stamp changes"],
    ["API-REFERENCE.md", "reference", "Human-readable endpoint reference with bodies and notes", "any request against the API", "build stamp changes"],
    ["data/endpoints.json", "data", "Every operation with id, auth, confidence and evidence", "filtering/querying the API surface", "regenerated by build-kb.mjs"],
    ["data/findings.json", "data", "Findings F-01..F-11 with severity, confidence and evidence", "assessing risk", "new finding or status change"],
    ["data/state-keys.json", "data", "Top-level `game` keys with types and economic flags", "working with save payloads", "save shape changes"],
    ["dist/context-pack.md", "pack", "Single-file condensed context for chat UIs without filesystem access", "pasting into a web model", "regenerated by build-kb.mjs"],
    ["api-client.extracted.js", "artifact", "Verbatim extracted client SDK (public code)", "checking exact request shapes", "new build"],
    ["fetch-wrapper.extracted.js", "artifact", "The M() fetch helper (public code)", "understanding retry/timeout behaviour", "new build"],
  ];

  const index = {
    meta: { game: "lagoslife.app", build: BUILD, captured: CAPTURED, generated_by: "tools/build-kb.mjs" },
    routing: {
      "call the API / write a client": ["API-REFERENCE.md", "data/endpoints.json"],
      "security review": ["REPORT.md", "data/findings.json"],
      "understand the save model": ["API-REFERENCE.md", "data/state-keys.json"],
      "check one endpoint": ["data/endpoints.json"],
      "no filesystem access": ["dist/context-pack.md"],
    },
    files: docsMeta.map(([file, kind, title, when, stale]) => {
      const full = p(file);
      const size = fs.existsSync(full) ? fs.statSync(full).size : 0;
      return { path: file, kind, title, bytes: size, tokens: tokens(size), when_to_read: when, stale_if: stale };
    }),
  };
  writeJson(p("index.json"), index);

  writeContextPack(endpoints);
  return { endpoints, counts: index };
}

function extractStateKeys() {
  const candidates = [
    p("private", "lagoslife.app.har"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let har;
    try {
      har = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const e of har.log?.entries || []) {
      if (e.request?.method !== "PUT" || !e.request.url.endsWith("/api/save")) continue;
      const text = e.request.postData?.text;
      if (!text) continue;
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        continue;
      }
      const game = body.game;
      if (!game || typeof game !== "object") continue;
      const ECONOMIC = new Set([
        "money", "bank", "businesses", "invest", "bets", "ledger", "fleet",
        "car", "cars", "home", "homes", "land", "tax", "billsOwed",
        "rentOwed", "rentPaidBy", "rentPaidUntil", "rentCut", "rentKeep",
        "lastRentDay", "pantry", "rewards", "blessings",
      ]);
      const keys = {};
      for (const [k, v] of Object.entries(game)) {
        const type = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
        keys[k] = {
          type,
          items: Array.isArray(v) ? v.length : undefined,
          economic: ECONOMIC.has(k),
        };
      }
      return {
        meta: {
          source: "PUT /api/save request body (capture #1)",
          build: BUILD,
          captured: CAPTURED,
          note: "Types and lengths only. No values are stored here.",
        },
        count: Object.keys(keys).length,
        economic: Object.keys(keys).filter((k) => keys[k].economic),
        keys,
      };
    }
  }
  return null;
}

function writeContextPack(endpoints) {
  const findings = readJson(p("data", "findings.json")).findings;
  const groups = [...new Set(endpoints.map((e) => e.group))];
  const lines = [];

  lines.push("# Lagos Life — context pack");
  lines.push("");
  lines.push(`Build **${BUILD}** · captured ${CAPTURED}. If \`/api/version\` returns a different build, treat this as stale.`);
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push("- Analysis was authorised on the owner's own account. Do **not** tamper with saves, forge game state, or test F-02 against a live account.");
  lines.push("- Confidence labels: `confirmed-live` (seen in a capture), `static-only` (present in the client SDK, never observed), `doc-only`.");
  lines.push("- Cite IDs (`F-01`, `EP-004`) and keep the confidence label attached to the claim.");
  lines.push("");
  lines.push("## Model in one paragraph");
  lines.push("");
  lines.push("Next.js client + JSON API on the same origin behind Cloudflare. Auth is a session cookie (`ll_session`, HttpOnly/Secure/SameSite=Lax); no bearer token, no CSRF token, no CORS. The client is authoritative for game state: it uploads the whole `game` object on `PUT /api/save` with the revision it edited (`base`); `409` means conflict or ownership takeover, `429` carries `retryIn`. Real-time is polling with `since` cursors, not WebSocket. Registration is Turnstile-gated.");
  lines.push("");
  lines.push("## Endpoints");
  for (const g of groups) {
    lines.push("");
    lines.push(`### ${g}`);
    for (const e of endpoints.filter((x) => x.group === g)) {
      const flags = [];
      if (e.auth === "none") flags.push("public");
      if (e.validation === "unverified" && e.method !== "GET") flags.push("input unverified");
      const tail = [e.note, flags.length ? `_${flags.join(", ")}_` : ""].filter(Boolean).join(" — ");
      lines.push(`- \`${e.method} ${e.path}\`${tail ? " — " + tail : ""}`);
    }
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push("| ID | Finding | Severity | Confidence |");
  lines.push("|---|---|---|---|");
  for (const f of findings) {
    lines.push(`| ${f.id} | ${f.title} | ${f.severity} | ${f.confidence} |`);
  }
  lines.push("");
  lines.push("Open the full report for evidence and recommendations.");

  const out = p("dist", "context-pack.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { endpoints } = build();
  const byConf = endpoints.reduce((a, e) => ((a[e.confidence] = (a[e.confidence] || 0) + 1), a), {});
  console.log(`endpoints: ${endpoints.length} across ${new Set(endpoints.map((e) => e.path)).size} paths`);
  console.log("confidence:", byConf);
  console.log("groups:", [...new Set(endpoints.map((e) => e.group))].join(", "));
}
