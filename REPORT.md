# Lagos Life (`lagoslife.app`) — Reverse Engineering Report

| | |
|---|---|
| **Target** | `https://lagoslife.app` — "Lagos Life", browser-based life-sim game |
| **Client build** | `1792451178` (also observed `1792444919`, `1792451178`) |
| **Report date** | 2026-10-20 |
| **Analyst** | Independent research, AI-assisted |
| **Status** | **Public** — published 2026-10-20 |
| **Scope** | Client-side application and its HTTP API surface |
| **Authorization** | Analysis performed on the author's own account and browser session |

> **For the operator.** Two items are worth your attention first: **F-01** (username
> enumeration on login, trivially reproducible) and **F-02** (the save endpoint accepts the
> client's full game state — whether it is validated server-side could not be determined
> from outside, and was deliberately not tested). Everything below F-02 is hardening.
> No other players' data was accessed, no forged state was written, and no load testing was
> performed. Corrections, redaction and takedown requests: see [`SECURITY.md`](SECURITY.md).

---

## 1. Executive summary

Lagos Life is a Next.js (Turbopack) life-simulation game. Its entire backend contract is exercised through a single-page client SDK of ~98 call sites covering **67 unique API paths**, served same-origin behind Cloudflare. The API is conventionally structured, uses a JSON error envelope, Cloudflare Turnstile for signup, and a revision-based optimistic-concurrency model for saves.

Across two authenticated HAR captures (455 requests, 162 of them API calls) and static analysis of the shipped JavaScript, the API surface resolves to **69 operations observed in traffic across 64 paths** — and **114 operations across 90 paths** once the declarations reachable only through static analysis are included (see `data/endpoints.json`).

### Headline results

| # | Finding | Severity | Confidence |
|---|---|---|---|
| F-01 | **Username enumeration** via `code: "no_user"` on login | Medium | **Confirmed** |
| F-02 | **Client-authoritative game state** — full economy uploaded on save | High *(if unvalidated)* | **Unverified** |
| F-03 | **Floating-point currency** in game state | Medium | **Confirmed** |
| F-04 | Client-submitted XP in `/api/levels` | Low–Medium | Unverified |
| F-05 | `admin` boolean exposed in `user` object | Low | Confirmed (impact unverified) |
| F-06 | CSRF posture | **Resolved — mitigated** | **Confirmed** |
| F-07 | Verbose, user-targeted error text | Low | Confirmed |
| F-08 | Personal data in semi-public listings | Low | Confirmed |
| F-09 | Client build-id as a trust signal | Low | Confirmed |
| F-10 | Long-lived session / device cookies | Low | Confirmed |
| F-11 | No `__Host-` cookie prefix | Low | Confirmed |
| F-12 | State-changing operations exposed as `GET` | Low | Confirmed |

**Bottom line:** the API is competently built in most respects — idempotency keys on messages, owner-conflict handling, backoff on 429 — but two structural risks stand out: the save endpoint accepts the player's entire economic state from the client, and login leaks whether a username exists. F-02 is the one that matters; it is also the one I deliberately did **not** test.

---

## 2. Scope, methodology, and ethics

### 2.1 What was done

| Phase | Method | Output |
|---|---|---|
| Static recon | Fetched the SSR shell, enumerated 17 eagerly-loaded `/_next/static/chunks/*.js`, downloaded them | 17 chunks ≈ 0.85 MB |
| SDK extraction | Located the API module by its `["api",0,{…}]` export signature | `api-client.extracted.js` (10.5 KB, 98 call sites) |
| Live probing | Unauthenticated `GET`s to confirm public endpoints, plus CORS probes | Status + shapes |
| Cookie inspection | Attributes read directly from DevTools → Application → Cookies | Flags for 4 cookies |
| Dynamic capture | Two HAR files exported from an authenticated browser session | 259 entries total |
| HAR decoding | Custom parser (base64-aware) + REA `inspect-web-network-capture` | 69 operations mapped |
| Correction pass | Compared capture against static map | 25 endpoint paths the static pass missed |

### 2.2 What was **not** done

- No authentication bypass, credential stuffing, or session forgery.
- No account creation (Turnstile-protected).
- No state-mutating requests from the analyst — every `PUT`/`POST` in the data came from the account owner's own browser.
- **No tampering tests.** I did not modify a save payload to see whether the server rejects an impossible balance. That is writing fraudulent state to a live production account, and is out of scope.
- No load, DoS, or fuzzing activity.

Total analyst-generated traffic: **9 requests** (6 public `GET`s, 1 header probe, 2 CORS probes).

### 2.3 Severity rubric

| Severity | Meaning |
|---|---|
| **Critical** | Direct account takeover or arbitrary fund creation, no preconditions |
| **High** | Economic integrity or wide data exposure, plausible abuse path |
| **Medium** | Meaningful information leak or defence-in-depth gap |
| **Low** | Minor leak, hardening issue, or requires unlikely preconditions |
| **Info** | Observation, not a defect |

---

## 3. Target overview

| Property | Value |
|---|---|
| Framework | Next.js with Turbopack, React Server Components |
| Hosting | Cloudflare in front of Vercel-style deployment (`x-nextjs-*` headers) |
| Rendering | SSR shell + heavy client game engine |
| Real-time | **Polling with cursors**, not WebSocket/SSE |
| Offline | Service worker (`sw.js`) — media caching only |
| Payments | Hosted checkout (`checkout_id`), provider not disclosed client-side |
| Captcha | Cloudflare Turnstile, site key `0x4AAAAAAFbzM3Xi2Yw74Dd2` (public) |
| Build freshness | `/build.json` + `/api/version` (`{build}`), drives reload prompt |

The client is minified but **not obfuscated**. Identifiers such as `loadSave`, `sendMoney`, `claimGem`, `danceAsk` survive in the bundle, which is what made a clean SDK recovery possible in minutes.

---

## 4. System architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Next.js shell (SSR)                                            │
│    ├── inline boot script  → /api/client-error (sendBeacon)     │
│    ├── sw.js               → caches /api/{ads,sea}/:id/image    │
│    └── client SDK (3z0xxwyie_394.js)                            │
│           M()  ── fetch, credentials:"same-origin", 15s timeout │
│                 ── 1 retry on network/5xx, jitter 1.2–2.4s      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS, same origin, JSON
                    ┌───────────▼───────────┐
                    │  Cloudflare (WAF)     │
                    └───────────┬───────────┘
                    ┌───────────▼───────────┐
                    │  Next.js route handlers│
                    │  /api/*                │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Game state store      │
                    │  revisioned by updatedAt│
                    └────────────────────────┘
```

### 4.1 Authentication model

- Session-based; the client never sets an `Authorization` header and contains no token logic.
- `credentials: "same-origin"` on every request.
- `GET /api/auth/me` returns **`200` with `{user: null, now}`** when signed out, rather than `401`. Authenticated endpoints (`/api/players`) return `401 {"error":"Please log in"}`.
- Login: `POST /api/auth/login` `{username, password}` → `200 {ok, username}` | `404 {error, code:"no_user"}`.
- Registration is Turnstile-gated; `GET /api/captcha?for=signup` returns the site key and a `teen` flag.

> **Capture caveat:** the auth credential does not appear in either HAR (0 `Cookie` headers, 0 `Set-Cookie`, 0 populated cookie arrays) despite login succeeding. Capture #2 is also missing `Origin` and `Sec-Fetch-*` on `PUT`, which Chrome always sends — so this was an **export artefact**, confirmed by direct inspection.

**Confirmed cookie attributes** (DevTools → Application → Cookies, host `lagoslife.app`, `Path=/`):

| Cookie | Purpose (inferred) | HttpOnly | Secure | SameSite | Expiry |
|---|---|---|---|---|---|
| `ll_session` | Session credential | ✓ | ✓ | `Lax` | 2026-12-19 (≈60 days) |
| `ll_vid` | Visitor/session id | ✓ | ✓ | `Lax` | 2026-12-19 |
| `ll_pass` | Short-lived step-up token | ✓ | ✓ | `Lax` | same day (≈18 min) |
| `ll_dev` | Device identifier | ✓ | ✓ | `Lax` | 2027-10-14 (≈1 year) |

All four are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. There is **no CSRF token cookie** and no cross-site CORS allowance. See F-06 for the resulting verdict.

### 4.2 Save / synchronisation model

The client is authoritative and syncs whole-object snapshots:

```
GET  /api/save            → { game, updatedAt, now }
PUT  /api/save            → { game, owner, base, build }
                          ← { ok, updatedAt, rk[] }
```

- `base` = the `updatedAt` revision the local edit was based on.
- `fresh` / `replace` on first save only; steady state is `{game, owner, base, build}`.
- `409` → server returns authoritative state; `code:"owner"` means the account moved to another tab/device.
- `429` → `retryIn`; client enforces a 2 s floor and `min(60s, 3s × 2^(strikes−1))` backoff.
- `outbox.notices` / `outbox.fx` are stripped before upload (local-only effects).

### 4.3 Real-time

No sockets. `/api/room?host=&since=`, `/api/messages?with=&since=` and `/api/world` polling carry presence and chat. `/api/world` both reports presence (`online`) and returns server feature flags (`cities`, `refinery`, `risk`, `econ`, `pol`, `tl`, `give`, `cred`, `soc`, `chd`, `homeExt`).

---

## 5. API structure

### 5.1 Conventions

| Aspect | Detail |
|---|---|
| Base | `https://lagoslife.app/api/*` (same origin) |
| Encoding | JSON request/response; `Content-Type: application/json` |
| Casing | `camelCase`; short keys in hot paths (`rk`, `nb`, `bm`, `tl`, `pol`) |
| Success | Resource object, or `{ok: true, …}` |
| Error | `{error: string, code?: string, retryIn?: number}` |
| Auth | Session cookie (see 4.1) |
| Pagination | **Cursor-based** `since` / `at` parameters, not offsets |
| Idempotency | `cid` on message send |
| Concurrency | `base` revision + `409` |
| Rate limit | `429` + `retryIn` |
| Dates | Epoch milliseconds (`updatedAt`, `now`, `endsAt`) |
| IDs | 20-char lowercase hex |

### 5.2 Authentication & account — `/api/auth/*`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/auth/me` | — | `{user|null, now}`; `user` = `{id, username, name, admin, terms}` |
| POST | `/api/auth/login` | `{username, password}` | `404 no_user` on unknown handle |
| POST | `/api/auth/register` | `{username, password, name, email, adult, born, captcha?, …ref}` | Turnstile required |
| POST | `/api/auth/logout` | — | |
| POST | `/api/auth/logout-all` | — | Kills all sessions |
| GET | `/api/captcha?for=signup` | — | `{siteKey, teen?}` |
| POST | `/api/auth/profile` | `{name}` | |
| POST | `/api/auth/username` | `{username, password}` | |
| POST | `/api/auth/password` | `{current, password}` | |
| POST | `/api/auth/terms` | `{adult, born, sure}` | |
| POST | `/api/auth/delete` | `{password, confirm:"delete"}` | |
| POST | `/api/auth/lock` | `{note}` | Self-lock |
| POST | `/api/auth/age-appeal` | `{…, adult:true}` | |
| POST | `/api/auth/forgot` | `{step:"questions"\|"email"\|"answer", …}` | 3-stage recovery |
| POST | `/api/auth/recovery` | opaque | |
| POST | `/api/auth/ticket` | `{ticket, answer, username}` | |
| POST | `/api/auth/reset` | `{token, password}` | |
| GET/POST | `/api/auth/email` | `{email}` / `{email, password}` | recovery email |
| GET/POST | `/api/auth/email/verify` | `{action:"send"\|"check", …}` | |
| GET/POST | `/api/auth/security` | `{seen}` | |
| GET | `/api/referrals` | — | |

### 5.3 Game state

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/save` | — | `{game, updatedAt, now}` — `game` has **133** top-level keys |
| PUT | `/api/save` | `{game, owner, base, build}` | `{ok, updatedAt, rk[]}` |
| GET | `/api/save/backup` | — | `{backup}` |
| GET | `/api/save/old-account` | — | `{old}` |
| GET | `/api/version` | — | `{build}` |

`game` includes: `version, phase, sim, needs, skills, money, bank, blessings, rewards, time, home, objects[], layoutV, queue, pos, path, location, work, job, relationships, romance, moodlets, power, fuel, weather, rentOwed, tax, wishes, events, freeWill, pantry, outbox, car, cars, fleet, businesses, homes, land, invest, bets, ledger, risk, cover, school, uni, courtLog, missions, streak, rep, storiesDone, memberships, team, billsOwed, edu, lvXp, owner, build …`

### 5.4 World & presence

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/world` | `{ins, location, look{…}, mood, activity, since, with, full, nb}` | `{now, online, load, cities, refinery, risk, econ, pol, tl, give, cred, soc, chd, homeExt, …}` |
| GET | `/api/daily` | — | `{date, weekday, weather, headline, tip}` — **public** |
| GET | `/api/live` | — | `{url}` (same-origin `/live`) |
| GET | `/api/players?q=` | — | `{players[]}` (auth required) |

### 5.5 Social, chat, moderation

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/messages` | — | `{threads[85], streaks, pins[]}` |
| GET | `/api/messages?with=&since=&voice=1` | — | `{unread, blocked, stream, messages[]}` |
| POST | `/api/messages` | `{to, body, cid}` | `cid` = idempotency key |
| POST | `/api/messages/voice` | `{with, on}` | |
| POST | `/api/messages/requests` | `{with}` | dismiss request |
| POST | `/api/messages/read` | `{with}` | |
| POST | `/api/say` | `{text}` | room chat |
| GET | `/api/room?host=&since=` | — | cursor poll |
| POST | `/api/room` | `{host, text}` | |
| POST | `/api/social` | `{to, socialId, ok}` | `dance:ask`, `dance:yes:<id>` |
| GET/POST | `/api/block` | `{userId, block}` | |
| POST | `/api/report` | `{userId, reason, note, job}` / `{reason:"support"\|"suggestion", …}` | |
| POST | `/api/board/vote` | `{ballot, choice}` | |

### 5.6 Economy & banking

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/send` | `{to, amount, note, pin?}` | `{ok, id, amount, fee}` |
| GET/POST | `/api/send-pin` | `{action:"set"\|"off", pin, password}` | `{on, set}` |
| GET | `/api/bank` | — | `{ok, bank, rates, snap, moves[]}` |
| POST | `/api/bank` | `{op, amount}` | `{ok, bank, rates, snap, move, money, moves[]}` |
| GET/POST | `/api/family` | `{action:"history"\|"claim"\|…, back?}` | `{schools, partner, kids[], incoming[], …}` |
| POST | `/api/party` | `{action}` | |
| GET/POST | `/api/hunt` | `?at` / POST claims | `{day, clue, endsAt, found, nextReward, leaders[]}` |
| GET/GET/POST | `/api/bail` | `?friends=1`, `{action:"ask"\|"pay"\|"visit", …}` | |
| POST | `/api/invite` | `{to}` | |
| POST | `/api/visit` | `{referrer, cookies}` | |
| POST | `/api/food-gift` | `{action, drinks}` | `{food[]}` |
| GET/POST | `/api/levels` | `{op, xp}` | `{on, xp, weekXp, streak{…}, chestAt, spinAt, …}` |

### 5.7 Property, homes, sea, ads marketplace

| Method | Path | Notes |
|---|---|---|
| GET | `/api/homes`, `?map=1`, `/api/homes/:id` | `{homes[400]}` |
| POST/GET/DELETE | `/api/homes/:id/knock` | knock system |
| POST | `/api/knock` `{guestId, ok}` | answer |
| GET/POST/DELETE | `/api/sea`, `/api/sea/:id` | `{ads[285], holds[43], price, days}` |
| GET | `/api/ads` | `{slots[62], price:250000, days:7}` |
| POST | `/api/ads` `{slot, link, image, currency}` | |
| DELETE | `/api/ads/:id` | |
| GET | `/api/ads/verify?checkout_id=` | payment verify |
| GET/PATCH | `/api/my-ads` `{kind, id, image}` | |
| GET | `/api/ads/:id/image`, `/api/sea/:id/image`, `/api/dev-games/img/:id/icon` | media, service-worker cached |

### 5.8 Meta-game & civic systems

| Method | Path | Body |
|---|---|---|
| GET | `/api/gov` (`?full=1`) | — |
| POST | `/api/gov/run` | `{slogan, v:2}` |
| POST | `/api/gov/vote` | `{candidate}` |
| POST | `/api/gov/policy` | `{policy}` |
| POST | `/api/gov/announce` | `{text}` |
| GET | `/api/politics` | — |
| GET | `/api/company?top` | — |
| GET | `/api/credibility` | — |
| GET | `/api/forbes` | — |
| GET | `/api/jets` | — |
| GET | `/api/squads` | — |
| GET | `/api/sponsors` | — |
| GET | `/api/zuko?at` | — |
| GET | `/api/games` (`?mine`,`?city`,`?fame`) | — |
| GET | `/api/dev-games` | — |
| GET | `/api/verified` | — |
| GET | `/api/cohabit/arrange?pending` | — |
| GET | `/api/p2p-day` | — |
| POST | `/api/venue` | `{kind, id}` / `{kind}` |
| GET/POST/PATCH/DELETE | `/api/push` | `{subscription}` / `{endpoint}` / prefs |
| GET | `/api/wallet/pending` | — |
| POST | `/api/wallet/checkout` | `{pack, currency}` |
| GET | `/api/wallet/verify?checkout_id=` | — |

### 5.9 Telemetry

| Method | Path | Body |
|---|---|---|
| POST | `/api/client-error` | `{message, stack, where, url, uid, screen, build}` via `sendBeacon` |
| GET | `/api/origin` | — |
| GET | `/api/go?s=` | referral redirect (returns HTML) |

### 5.10 Error & status semantics

| Status | Meaning | Client behaviour |
|---|---|---|
| `200` | OK | parse JSON |
| `204` | No-op (save suppressed) | treat as success |
| `401` | Not signed in | force logout |
| `404 + no_user` | Unknown username | inline error |
| `409` | Revision or ownership conflict | adopt server state / stop saving |
| `429` | Rate limited | wait `retryIn`, back off |
| `5xx` | Transient | 1 retry, then "busy" message |
| non-JSON body | Edge/WAF block | "security check" message |

---

## 6. Findings

### F-01 — Username enumeration · **Medium** · Confirmed

`POST /api/auth/login` returns a distinct outcome for a non-existent account:

```json
{ "error": "We can't find a player called \"<name>\". Check the spelling…", "code": "no_user" }
```

versus a different response for a real account with a bad password. The `code` field makes this machine-detectable without parsing prose.

**Reproduce** (one request; no account needed):

```bash
curl -s -w '\n%{http_code}\n' -X POST https://lagoslife.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"no_such_player_zz9","password":"invalid"}'  # allow-secret: dummy value
```

Expected: `404` with `{"error":"We can't find a player called …","code":"no_user"}`.
A registered handle does **not** return `no_user`; that code is the discriminator, independent
of the wording. The wrong-password branch was not captured, so its exact text is not quoted here.

**Impact:** anyone can test whether a handle is registered — useful for targeted phishing, credential stuffing shortlists, and mapping the player base. The error message also echoes the submitted name, which is an invitation to reflected-content tricks in any client that renders it unsafely.

**Recommendation:** return a single generic failure (`invalid_credentials`) for both cases, and never echo input back. A per-IP rate limit on `/api/auth/login` would blunt bulk enumeration even before the message is fixed.

---

### F-02 — Client-authoritative economic state · **High if unvalidated** · Unverified

`PUT /api/save` uploads the **entire game object**, including `money`, `bank`, `businesses`, `invest`, `bets`, `cars`, `fleet`, `ledger`, `tax`, `rentOwed`. The only integrity control visible is `base`, which detects *concurrent* edits — not *implausible* ones.

**What is confirmed:** the server accepts a full client snapshot and replies `{ok, updatedAt}`; the client treats its own object as the source of truth.

**What is not confirmed:** whether the server independently re-derives balances, validates deltas, or cross-checks transactions. A save accepted at `200` is consistent with both "fully validated" and "trusted blindly".

**Impact if unvalidated:** arbitrary currency and asset creation, trivial leaderboard/economy corruption, and monetisation bypass.

**Recommendation (developer):** treat the save body as untrusted input. Persist only deltas or validate every economic field against server-held authoritative values; keep the revision model for conflicts. A server-side invariant pass that rejects implausible jumps (e.g. balance delta exceeding known earning rates) would close this class.

**Why I did not test it:** doing so means writing forged state into a live account. That is out of scope for this engagement and, depending on terms of service, may itself be a violation. If the owner wants this verified, it should be done with the vendor's written permission on a staging account.

---

### F-03 — Floating-point currency · **Medium** · Confirmed

Monetary values are JSON numbers with fractional parts; an observed balance carried five decimal places (`…864.67285`). Transfer amounts are integers, but the stored balance is not.

**Impact:** classic binary-float drift — `0.1 + 0.2` problems accumulate across savings interest, fees, rent and taxes. Symptoms: off-by-one-kobo balances, failed exact-match comparisons, "you can't afford this" on a balance that displays enough, and rounding exploits when a fee is computed on a fractional base.

**Recommendation:** store minor units (kobo) as integers, or a decimal string. Never persist currency as IEEE-754 float.

---

### F-04 — Client-submitted XP · **Low–Medium** · Unverified

`POST /api/levels` sends `{op, xp}` where `xp` is chosen by the client. In the capture, XP moved `16 → 30` after submitting `xp: 26`, so the server is clearly not blindly adding the submitted number — encouraging, but the value is still client-originated input.

**Impact if weakly validated:** level/streak inflation, chest and spin-reward farming.

**Recommendation:** derive XP from server-recorded actions; accept an action id, not an amount.

---

### F-05 — `admin` flag exposed to the client · **Low** · Confirmed

`GET /api/auth/me` returns `user.admin` as a boolean. Exposing it is only cosmetic **if** every privileged route re-checks authorisation server-side.

**Impact:** none by itself; becomes High if any endpoint trusts a client-supplied or cached `admin` value.

**Recommendation:** confirm every admin action is authorised server-side; consider omitting the flag from the client payload entirely.

---

### F-06 — CSRF posture · **Resolved — mitigated** · Confirmed

The client sends no CSRF token on any of the 69 operations, so protection rests on cookie attributes plus CORS. Both are now confirmed:

| Control | Observation |
|---|---|
| `SameSite` | `Lax` on all four cookies → not sent on cross-site `POST`/`PUT`/XHR |
| `HttpOnly` | All four → unreadable by JavaScript, so XSS cannot steal the session |
| `Secure` | All four → HTTPS only |
| CORS | `OPTIONS /api/send` with foreign `Origin` → `204`, **no** `Access-Control-Allow-Origin` / `-Credentials`; cross-origin `GET /api/auth/me` → no ACAO |
| Content type | JSON-only API; cross-site HTML forms cannot emit `application/json`, and a JSON request would require a preflight that fails |

**Verdict:** cross-site request forgery is **not** practically exploitable. No CSRF finding to report.

Residual hardening: add server-side `Origin`/`Sec-Fetch-Site` checks on non-GET routes so safety does not depend solely on browser defaults, and see F-11 for the cookie-prefix issue.

**Caveat — mutating GETs:** `SameSite=Lax` still attaches cookies to **top-level cross-site navigations**, and two payment paths are `GET`s: `/api/wallet/verify?checkout_id=` and `/api/ads/verify?checkout_id=`. An attacker who can make a victim click a link could therefore trigger a verification request. Impact is low (it acts on the victim's own pending checkout and needs a valid `checkout_id`), but the correct fix is to make state-changing operations non-GET and reject `GET` on them.

---

### F-07 — Verbose, name-echoing error text · **Low** · Confirmed

Errors are written for end users and include specifics: missing username with the submitted value, "Please log in", "Lagos is a bit busy right now". Useful UX, but it also confirms internal state to an attacker and can aid enumeration (F-01).

**Recommendation:** keep friendly copy for UI, add a stable machine `code` for clients, and avoid echoing user input verbatim.

---

### F-08 — Personal data in semi-public listings · **Low** · Confirmed

| Endpoint | Exposes |
|---|---|
| `/api/forbes` | top 50 players with profiles |
| `/api/players?q=` | searchable player list (25/response) |
| `/api/verified` | 21 `[id, name]` pairs |
| `/api/world` | live `online` count (`20 475` observed) |
| `/api/games` | open/playing game lists |

**Impact:** aggregate player enumeration and activity telemetry. Individually minor; combined with F-01 it enables broad account mapping.

**Recommendation:** rate-limit and paginate search; consider hiding exact online counts.

---

### F-09 — Client build-id as a trust signal · **Low** · Confirmed

`PUT /api/save` includes `build: "1792451178"`, and the client gates behaviour on `/api/version` + `/build.json`. A build id is a version marker, not an attestation.

**Impact:** if the server uses it for compatibility gating, an altered client can claim any build. No security decision should depend on it.

**Recommendation:** treat as telemetry only.

---

### F-10 — Long-lived session and device cookies · **Low** · Confirmed

`ll_session` persists ~60 days and `ll_dev` ~1 year, with no evidence of rotation on privilege change or on password update.

**Impact:** any cookie exfiltration path — malware on a shared machine, a browser profile backup, a stolen laptop — yields long-lived authenticated access. `ll_dev` is the more interesting of the two: a year-long device identifier is either a benign tracking id or a "trusted device" credential, and the difference matters.

**Recommendation:** rotate the session on password change and privilege escalation; shorten the idle window and refresh it for active players; document what `ll_dev` is used for and ensure it is not the sole factor for sensitive actions.

---

### F-11 — No `__Host-` cookie prefix · **Low** · Confirmed

Cookies are named `ll_session`, `ll_pass`, etc., not `__Host-ll_session`. The `__Host-` prefix is enforced by browsers to require `Secure`, `Path=/`, and **forbid** a `Domain` attribute.

**Impact:** without the prefix, any party able to set cookies for a sibling subdomain (`*.lagoslife.app`) could plant a cookie with the auth name — cookie tossing / session fixation. Requires a compromised or attacker-controlled subdomain, hence Low.

**Recommendation:** rename to `__Host-ll_session`, `__Host-ll_pass`, `__Host-ll_dev` and confirm no `Domain` attribute is set. Cheap, permanent hardening.

---

### F-12 — State-changing operations exposed as `GET` · **Low** · Confirmed

`SameSite=Lax` blocks cookies on cross-site `POST`/`PUT`, but it still sends them on **top-level cross-site navigation**. Two verification paths are `GET`s:

- `GET /api/wallet/verify?checkout_id=`
- `GET /api/ads/verify?checkout_id=`

**Impact:** a crafted link can trigger verification for the victim's own pending checkout. Low, because it requires a valid `checkout_id` and acts only on the victim's own payment.

**Recommendation:** move verification to `POST` and reject `GET` on state-changing routes.

---

### 6.10 What the design gets right

Worth stating explicitly, because these are the controls that make F-02 less likely to be trivially exploitable:

- **Idempotency:** every outbound message carries a client `cid`.
- **Optimistic concurrency:** `base` + `409`, with an explicit `owner` conflict code for multi-device play.
- **Backoff:** 2 s save floor, exponential `409/429` backoff with a 60 s cap, and 15 s per-request abort.
- **Turnstile** on registration.
- **Edge WAF** in front of everything, with a non-JSON block path the client handles gracefully.
- **Idempotent GET semantics** and cursor pagination (`since`) rather than offset paging.
- **Layered cookie hardening** — all cookies are `HttpOnly` + `Secure` + `SameSite=Lax`.
- **Short-lived step-up credential** — `ll_pass` expires in ~18 minutes, implying re-authentication for sensitive actions rather than a permanent privileged session.

---

## 7. Limitations and open questions

1. **Auth credential absent from the HARs** — an export artefact, not a design quirk. Cookie attributes were confirmed directly in DevTools, closing F-06; session-rotation policy beyond cookie expiry remains unobserved.
2. **Server-side validation unknown** → F-02 and F-04 cannot be graded without vendor-authorised testing.
3. **Happy-path capture only** — no `409`, `429`, `401`, or `5xx` was triggered, so those branches are inferred from client code, not observed.
4. **Lazy modules partially mapped** — 25 endpoint paths were discovered only through captures; their POST/PATCH variants are likely under-enumerated.
5. **Payment provider unidentified** — checkout is server-side; no provider string or key in the bundle (which is correct).
6. **Static coverage** — only the 17 eagerly-loaded chunks plus captured initiators were analysed; roughly 10 further chunks were identified but not downloaded.

---

## 8. Recommendations

### For the vendor (highest value first)

1. **Validate the save server-side** (F-02). Treat the client snapshot as untrusted. This is the single highest-impact change.
2. **Fix login enumeration** (F-01): one generic failure, stable code, no echoed input.
3. **Move currency to integer minor units** (F-03).
4. **Harden cookie scope** (F-10, F-11): adopt `__Host-` prefixes, rotate sessions on password change, and add server-side `Origin` checks — F-06 is already mitigated, this makes it intentional rather than incidental.
5. **Derive XP server-side** (F-04).
6. **Audit `admin` enforcement** on every privileged route (F-05).

### For the owner of this report

- F-06 is now **closed** (mitigated by `SameSite=Lax` + no CORS + JSON-only bodies). The remaining unknowns are F-02 and F-04, which need vendor-authorised testing on a non-production account.
- If you report to `support@lagoslife.app`, lead with F-01 (easy to reproduce, easy to fix) and F-02 (highest value, needs their internal knowledge to confirm).
- **Do not** test F-02 on a live account.

---

## 9. Reproduction appendix

```bash
# 1. enumerate shipped chunks
curl -s https://lagoslife.app/ | grep -oE '/_next/static/chunks/[A-Za-z0-9._~-]+\.js' | sort -u

# 2. locate the API SDK inside them
#    signature:  e.s(["api",0,{me:()=>M("/api/auth/me")
#    wrapper:    async function M(e,t){ ... credentials:"same-origin" ... }

# 3. public endpoints
curl -s https://lagoslife.app/api/version
curl -s https://lagoslife.app/api/auth/me
curl -s "https://lagoslife.app/api/captcha?for=signup"
curl -s https://lagoslife.app/api/daily

# 4. CORS posture (expect: no Access-Control-Allow-Origin)
curl -s -o /dev/null -D - -X OPTIONS https://lagoslife.app/api/send \
  -H "Origin: https://example.invalid" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | grep -i "access-control\|HTTP/"

# 5. HAR analysis
npx -y rea-agents@latest inspect-web-network-capture "<abs path>.har" har --record 0 --format json
#    Requirement: serverIPAddress must be IPv4; empty strings are rejected.
#    Fix: delete the field on such entries before analysis.
```

### Tooling note

REA's `analyze-web-bundle` (CDP-driven) **hung** against this target — the game keeps long-lived connections and never reaches the quiescent state the capture expects. Direct chunk download + static extraction was faster and fully reproducible. REA's HAR adapter worked well once the `serverIPAddress` schema issue was worked around, and its **initiator stacks** were the most valuable single output: they attribute each API call to a specific chunk and function.

---

## 10. Artifacts and handling

| File | Contents | Sensitivity |
|---|---|---|
| `REPORT.md`, `API-REFERENCE.md` | Analysis and endpoint reference | Low |
| `data/*.json` | Derived facts only — types and metadata, no values | Low |
| `api-client.extracted.js` | Client SDK (10.5 KB) | Low — public code |
| `fetch-wrapper.extracted.js` | Request helper | Low — public code |
| `private/lagoslife.app.har` | Personal data (messages, account details, player ids) — **not published** | **High** |
| `private/lagoslife.app.2.har` | Login flow and save state — **not published** | **High** |

The HAR files live in `private/`, which is gitignored and excluded from the knowledge base's
agent-facing documents. Delete them once the findings are confirmed:

```powershell
# run from the repository root
Remove-Item .\private\lagoslife.app.har, .\private\lagoslife.app.2.har
```

No credentials, session tokens, passwords, email addresses, or player handles appear in this report.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **HAR** | HTTP Archive — JSON recording of browser network activity |
| **Turnstile** | Cloudflare's CAPTCHA replacement |
| **Optimistic concurrency** | Client sends the revision it based an edit on; server rejects stale writes |
| **Idempotency key** | Client-generated id ensuring a retried write applies once |
| **CDP** | Chrome DevTools Protocol |
| **SW** | Service Worker |
| **`base`** | Revision (`updatedAt`) a save was based on |
| **`cid`** | Client message id used for idempotent sends |
| **`rk`** | Opaque 3-element array returned by save (purpose unknown — likely rank/reward keys) |
