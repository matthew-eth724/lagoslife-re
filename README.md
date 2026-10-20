# Lagos Life — API notes and security findings

Independent black-box analysis of the HTTP API behind `lagoslife.app` (a browser
life-sim game): how it authenticates, how it saves state, what every endpoint does, and
where it is weak.

**Build `1792451178` · captured 2026-10-20.** If `/api/version` returns a different build,
treat the details as historical.

## Start here

| You are… | Read |
|---|---|
| An AI agent | [`AGENTS.md`](AGENTS.md) — entry contract, routing, rules |
| A human wanting the findings | [`REPORT.md`](REPORT.md) — methodology, F-01…F-12, recommendations |
| A developer calling the API | [`API-REFERENCE.md`](API-REFERENCE.md) — endpoints, bodies, responses |
| A model with no filesystem | [`dist/context-pack.md`](dist/context-pack.md) — 1.9k-token summary |

## Layout

```
AGENTS.md              agent entry point
CLAUDE.md              pointer for Claude Code
index.json             machine manifest (paths, token counts, when to read)
REPORT.md              full analysis
API-REFERENCE.md       endpoint reference
SECURITY.md            disclosure status and handling rules
data/endpoints.json    114 operations with ids, auth, evidence, observed status
data/findings.json     12 findings as filterable fields
data/state-keys.json   133 save-state keys, types only
data/id-map.json       stable EP-id ledger
dist/context-pack.md   condensed single-file pack
tools/                 generator and validator
```

Regenerate and check:

```bash
node tools/build-kb.mjs
node tools/validate.mjs
```

The capture files are not included. Without them the generator refuses to rebuild, so the
evidence labels in `data/endpoints.json` cannot be silently downgraded.

## Disclosure

This repository is **not affiliated** with the game's operator, and nothing in it grants
permission to test the service. See [`SECURITY.md`](SECURITY.md) for the disclosure status
and the rules — in particular, do not test the save-validation finding against a live
account.

## License

Content is licensed under [CC BY 4.0](LICENSE). Attribution: *Lagos Life — API notes and
security findings, 2026, the repository authors.*

The extracted client JavaScript under `api-client.extracted.js` and
`fetch-wrapper.extracted.js` is the vendor's code, reproduced for reference; the license
above applies to the analysis, not to that code.
