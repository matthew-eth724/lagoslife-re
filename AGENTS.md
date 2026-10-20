# Lagos Life — agent context

Knowledge base for `https://lagoslife.app` (browser life-sim game): its HTTP API, its
architecture, and the flaws found in it. Written to be loaded by coding agents.

**Build `1792451178` · captured 2026-10-20 · status: current while `/api/version` matches.**

> If `/api/version` returns a different build, this KB is **stale**. Say so before answering,
> and treat endpoint shapes as historical until re-captured.

---

## Read this first

| If the task is… | Read |
|---|---|
| Call the API, write a client, debug a request | `API-REFERENCE.md`, then `data/endpoints.json` |
| Security review, risk assessment, write-up | `REPORT.md` §6, then `data/findings.json` |
| Understand the save/sync model | `API-REFERENCE.md` §4 + `data/state-keys.json` |
| Look up one endpoint | `data/endpoints.json` (grep by path) |
| No filesystem access (web chat) | `dist/context-pack.md` |
| Decide what to read at all | `index.json` |

Do not load `REPORT.md` and `API-REFERENCE.md` together unless the task needs both —
roughly 13k tokens of the context budget.

---

## Hard rules

1. **Scope.** The original analysis was authorised, performed on the owner's own account
   and browser session. It did not include tampering, auth bypass, or load testing.
2. **Do not test F-02** (client-authoritative economy) against a live account. Writing a
   forged save is out of scope and may breach the game's terms. It needs written vendor
   permission and a staging account.
3. **Never read or quote `private/*.har`.** Those files contain personal data (messages,
   emails, player ids). Only derived facts belong in this KB.
4. **Do not re-run risky probes** to "verify" something already marked `confirmed`. The
   label is the evidence.
5. **Never invent endpoints, fields, or status codes.** If it is not in
   `data/endpoints.json` or the docs, it is unknown — say unknown.

---

## Confidence labels

Every claim carries one. Keep the label attached when you repeat it.

| Label | Meaning |
|---|---|
| `confirmed-live` | Observed in a HAR capture; status codes recorded in `data/endpoints.json` |
| `confirmed` | Confirmed by direct inspection or a live probe (see the finding's `evidence`) |
| `static-only` | Present in the shipped client SDK, but never observed in traffic |
| `doc-only` | Declared in documentation but absent from both SDK and captures |
| `unverified` | Shape known, validation depth unknown — do not state as fact |
| `inference` | Reasoning from the above; label it as such |

---

## Conventions

- **IDs are stable.** `F-nn` = finding, `EP-nnn` = endpoint, `SK-<key>` = game-state key.
  Cite them; they are grep-able and survive rewrites.
- **One source of truth per fact.** Endpoint facts live in `data/endpoints.json`; the
  markdown explains *why*. `tools/validate.mjs` fails the build if they diverge.
- **Do not hand-edit generated files** (`data/endpoints.json`, `index.json`,
  `dist/context-pack.md`). They are produced by `node tools/build-kb.mjs`.
- `data/id-map.json` is the ID ledger. Never delete entries; IDs are never reused.

## Maintenance

```bash
node tools/build-kb.mjs     # regenerate data/endpoints.json, index.json, context pack
node tools/validate.mjs     # IDs, link targets, doc drift, build stamp, secret scan
```

When you add an endpoint: document it in `API-REFERENCE.md`, then rebuild — the generator
assigns the next `EP-` id automatically and the validator confirms the two agree.

When you add a finding: add it to `data/findings.json` **and** `REPORT.md` §6, keeping the
same `F-` id.

When a new build ships: update `BUILD`/`CAPTURED` in `tools/lib.mjs`, re-capture, rebuild,
and bump the stamp at the top of this file.

## Map

```
AGENTS.md                  this file — entry contract
index.json                 machine manifest (paths, token counts, when to read)
REPORT.md                  analysis: methodology, architecture, F-01..F-12
API-REFERENCE.md           endpoint reference with bodies and notes
data/endpoints.json        every operation: id, auth, confidence, evidence, observed status
data/findings.json         findings as fields, for filtering and citation
data/state-keys.json       top-level `game` keys with types and economic flags
data/id-map.json           stable EP-id ledger
dist/context-pack.md       ~2k-token condensed pack for filesystem-less agents
tools/build-kb.mjs         generator
tools/validate.mjs         integrity checks
tools/lib.mjs              shared parsing/normalisation
private/                   raw HARs — gitignored, never context
api-client.extracted.js    verbatim extracted client SDK (public code)
fetch-wrapper.extracted.js the M() fetch helper (public code)
```
