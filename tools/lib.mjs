// Shared parsing helpers for the Lagos Life knowledge base.
// Keeps the markdown and the JSON from drifting apart.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD = "1792451178";
export const CAPTURED = "2026-10-20";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Normalise a path so `/api/homes/abc123.../knock` and `/api/homes/:id/knock` match. */
export function normPath(p) {
  return p
    .split("?")[0]
    .split("/")
    .map((seg) =>
      seg.startsWith(":") ||
      seg.startsWith("${") ||
      /^[0-9a-f]{8,}$/i.test(seg) ||
      /^[a-z0-9][a-z0-9-]{15,}$/i.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
}

/** Extract every `METHOD /api/...` operation declared in the markdown tables. */
export function parseDocs(root = ROOT) {
  const ops = new Map();
  for (const file of ["API-REFERENCE.md", "REPORT.md"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4) continue;

      let methods = [];
      const mcell = cells[1];
      if (new RegExp(`^(${METHODS.join("|")})(\\s*/\\s*(${METHODS.join("|")}))*$`).test(mcell)) {
        methods = mcell.split("/").map((s) => s.trim());
      } else {
        const inline = mcell.match(new RegExp(`^\`?(${METHODS.join("|")})\\s+(/api/[^\`]+)\`?$`));
        if (!inline) continue;
        const rawPath = inline[2].split("?")[0];
        const key = `${inline[1]} ${normPath(rawPath)}`;
        if (!ops.has(key)) {
          ops.set(key, { method: inline[1], path: rawPath, query: null, file });
        }
        continue;
      }

      const pathCell = cells[2] || "";
      const found = [...pathCell.matchAll(/`(\/api\/[^`]*)`/g)].map((m) => m[1]);
      for (const raw of found) {
        const [p, ...q] = raw.split("?");
        for (const method of methods) {
          const key = `${method} ${normPath(p)}`;
          if (!ops.has(key)) {
            ops.set(key, { method, path: p, query: q.length ? q.join("?") : null, file });
          }
        }
      }
    }
  }
  return [...ops.values()];
}

/** Paths the shipped client actually calls, from the extracted SDK. */
export function parseStatic(root = ROOT) {
  const file = path.join(root, "api-client.extracted.js");
  if (!fs.existsSync(file)) return new Map();
  const sdk = fs.readFileSync(file, "utf8");
  const out = new Map();
  for (const m of sdk.matchAll(/M\(\s*[`"']([^`"']+)[`"']/g)) {
    const raw = m[1];
    if (!raw.startsWith("/api/")) continue;
    out.set(normPath(raw), raw);
  }
  return out;
}

/** method+path observed in the HAR captures, with the status codes seen. */
export function parseHar(root = ROOT) {
  const out = new Map();
  const files = [
    { tag: "har:1", p: path.join(root, "private", "lagoslife.app.har") },
    { tag: "har:2", p: path.join(root, "private", "lagoslife.app.2.har") },
  ];
  for (const { tag, p } of files) {
    if (!fs.existsSync(p)) continue;
    let har;
    try {
      har = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    for (const e of har.log?.entries || []) {
      let u;
      try {
        u = new URL(e.request.url);
      } catch {
        continue;
      }
      if (!u.pathname.startsWith("/api/")) continue;
      const key = `${e.request.method} ${normPath(u.pathname)}`;
      const rec = out.get(key) || { sources: new Set(), statuses: new Set(), query: new Set() };
      rec.sources.add(tag);
      if (e.response?.status) rec.statuses.add(e.response.status);
      if (u.search) rec.query.add(u.search);
      out.set(key, rec);
    }
  }
  return out;
}

export function groupOf(apiPath) {
  const first = apiPath.replace(/^\/api\//, "").split("/")[0];
  if (["auth", "captcha", "referrals"].includes(first)) return "auth";
  if (["save", "version", "levels", "food-gift", "family", "party"].includes(first)) return "state";
  if (["world", "daily", "live", "players", "go", "origin", "client-error"].includes(first)) return "world";
  if (["messages", "room", "say", "social", "block", "report", "board"].includes(first)) return "social";
  if (["send", "send-pin", "bank", "hunt", "bail", "invite", "visit"].includes(first)) return "economy";
  if (["homes", "knock", "sea", "ads", "my-ads", "cohabit"].includes(first)) return "property";
  if (first === "wallet") return "billing";
  if (["gov", "politics", "company", "credibility", "forbes", "jets", "squads", "sponsors",
       "zuko", "games", "dev-games", "verified", "p2p-day", "venue", "push", "og-image"].includes(first)) return "civic";
  return "misc";
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export function tokens(bytes) {
  return Math.ceil(bytes / 4);
}
