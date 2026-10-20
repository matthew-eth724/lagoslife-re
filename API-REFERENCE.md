# Lagos Life (`lagoslife.app`) — API Reference

**Derived from:** static analysis of the client bundle served at `https://lagoslife.app/`
**Date:** 2026-10-20  ·  **Client build:** `1792451178`
**Method:** downloaded the 17 `/_next/static/chunks/*.js` files referenced by the SSR HTML, located the single API-client module (`3z0xxwyie_394.js`), and extracted it verbatim (no deobfuscation needed — the bundle is minified but not obfuscated). Public endpoints were then confirmed with live unauthenticated requests.
**Updated:** 2026-10-20 — cross-checked against a 307-entry HAR from an authenticated session. See §10 for corrections, new endpoints, and one unresolved anomaly.

> Scope: documentation of the client's own request surface. No authentication was bypassed, no accounts created, and no state-changing calls were made.

---

## 1. Architecture at a glance

| Property | Value |
|---|---|
| Stack | Next.js (Turbopack) + React, SSR shell + client game |
| API origin | Same origin — `https://lagoslife.app` (no separate API host) |
| Transport | JSON over HTTPS; every call is `fetch` with `Content-Type: application/json` |
| Auth | **Session cookie**, sent via `credentials: "same-origin"`. **No `Authorization` header, no bearer token, no visible CSRF token** |
| Real-time | **Polling, not WebSocket/SSE.** Cursor-based (`since` param) on rooms and messages |
| Error envelope | JSON `{ "error": string, "code"?: string }` |
| Versioning | Client build id sent on save; `/api/version` + `/build.json` used for update detection |

### Request wrapper semantics
Reconstructed from the minified `M()` helper:

- 15 s `AbortController` timeout per request.
- Retries **once** (after 1.2–2.4 s jitter) on network error or **5xx**.
- `cache: "no-store"`; `credentials: "same-origin"`.
- A **non-JSON** error response triggers the message about a "security check on the way to Lagos Life" — i.e. an edge/WAF block (likely Cloudflare) returns HTML instead of JSON.
- `401` → session-expired handler; `429` → back off using `retryIn`; `5xx` → "Lagos is a bit busy".

---

## 2. Authentication

Registration is Turnstile-protected. `GET /api/captcha?for=signup` returns the site key; the token is posted as `captcha` on register.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/auth/me` | — | Returns `{ user: null, now: <epoch ms> }` when logged out (**200, not 401**). `now` is used to sync the client clock |
| POST | `/api/auth/register` | `{username, password, name, email, adult: true, born, ...ref, captcha?}` | `born` drives age gating |
| POST | `/api/auth/login` | `{username, password}` | Response may set `restored: true` (recovered save) |
| POST | `/api/auth/logout` | — | |
| POST | `/api/auth/logout-all` | — | Invalidates all sessions |
| GET | `/api/captcha?for=signup` | — | `{ siteKey, teen? }` — Turnstile |

**Account management**

| Method | Path | Body |
|---|---|---|
| POST | `/api/auth/profile` | `{name}` |
| POST | `/api/auth/username` | `{username, password}` |
| POST | `/api/auth/password` | `{current, password}` |
| POST | `/api/auth/terms` | `{adult: true, born, sure}` |
| POST | `/api/auth/delete` | `{password, confirm: "delete"}` |
| POST | `/api/auth/lock` | `{note}` |
| POST | `/api/auth/age-appeal` | `{...fields, adult: true}` |

**Password recovery / email**

| Method | Path | Body |
|---|---|---|
| POST | `/api/auth/forgot` | `{step: "questions", login}` · `{step: "email", login, email?, contact?}` · `{step: "answer", login, answers}` |
| POST | `/api/auth/recovery` | opaque object |
| POST | `/api/auth/ticket` | `{ticket, answer, username}` |
| POST | `/api/auth/reset` | `{token, password}` |
| GET / POST | `/api/auth/email` | `{email}` or `{email, password}` |
| GET / POST | `/api/auth/email/verify` | `{action: "send", email}` · `{action: "check", code}` |
| GET / POST | `/api/auth/security` | `{seen}` |
| GET | `/api/referrals` | — |

Signup includes `for`/referral fields merged in from a referral helper (`refForSignup()`); `/api/go?s=` is a referral/tracking redirect that returns HTML.

---

## 3. Game state — the important part

The client is **authoritative over game state** and syncs the whole object with optimistic concurrency.

### `GET /api/save`
Returns `{ game, updatedAt }`. The client only adopts the payload when `updatedAt` is newer than its local cached value.

### `PUT /api/save`
```jsonc
{
  "game":  { /* entire game object, owner injected, outbox stripped */ },
  "owner": "<player id>",
  "base":  <updatedAt the client based this edit on>,   // omitted on first save
  "fresh": true,                                        // first save only
  "replace": <updatedAt>,                               // forces replacement, first save
  "build": "1792451178"
}
```
Oddities: `outbox.notices` and `outbox.fx` are **cleared client-side before upload** — they are local UI effects, not persisted state.

### Responses and client-side protocol
| Status | Client behaviour |
|---|---|
| `200` | Stores `updatedAt`; reads `canSend` (message cooldown), `collect`, `efcc`, `land`, `rk` side-channel flags |
| `204` | Save suppressed (no active session / nothing to write) |
| `409` | **Conflict.** `code: "owner"` → session taken over elsewhere, client stops saving. Otherwise response contains the server's authoritative `game` + `updatedAt`, which the client adopts. May include `refused.amount`, `progress`, `facts`, `land`, `bm` |
| `429` | Rate limited; waits `retryIn` then retries |
| `401` | Session expired → logout |

**Rate limiting is explicit in the client:** a minimum 2 s gap between saves, plus exponential backoff on `409`/`429` — `min(60 s, 3 s × 2^(strikes−1))`, bounded by `holdUntil`.

> ⚠️ Implication: because the full game object is uploaded, the server *appears* to accept client-supplied state and use `base` only for conflict detection. Whether it fully re-validates every field (economy, currency, inventory) is **not determinable statically** — do not assume either way. Testing that would mean writing falsified state to a live account, which I won't help with.

---

## 4. World, social, and messaging

| Method | Path | Body / query |
|---|---|---|
| POST | `/api/world` | arbitrary event object |
| GET | `/api/daily` | — (public: `{date, weekday, weather, headline, tip}`) |
| POST | `/api/social` | `{to, socialId, ok}` — e.g. `dance:ask`, `dance:yes:<id>` |
| GET | `/api/messages` | — (thread list) |
| GET | `/api/messages?with=&since=&voice=1` | — cursor polling |
| POST | `/api/messages` | `{to, body}` |
| POST | `/api/messages/voice` | `{with, on}` |
| POST | `/api/messages/requests` | `{with}` |
| POST | `/api/messages/read` | `{with}` |
| GET | `/api/players?q=` | — search (401 without session) |
| GET | `/api/room?host=&since=` | — cursor polling |
| POST | `/api/room` | `{host, text}` |
| POST | `/api/say` | `{text}` |
| GET / POST | `/api/block` | `{userId, block}` |
| POST | `/api/report` | `{userId, reason, note, job}` · `{reason: "support", note}` · `{reason: "suggestion", note, kind}` |

---

## 5. Economy, property, and meta-game

| Method | Path | Body |
|---|---|---|
| POST | `/api/send` | `{to, amount, note, pin?}` |
| GET / POST | `/api/send-pin` | `{action: "set", pin, password}` · `{action: "off", password}` |
| GET / POST | `/api/family` | `{action: "history"}` · `{action: "claim", back?}` |
| POST | `/api/party` | `{action}` |
| GET / POST | `/api/hunt` | POST claims the gem |
| GET / POST | `/api/bail` | `?friends=1` for friends; POST variants below |
| POST | `/api/invite` | `{to}` |
| POST | `/api/visit` | `{referrer, cookies}` |
| POST | `/api/board/vote` | `{ballot, choice}` |
| POST | `/api/venue` | `{kind, id}` · `{kind}` |

**`/api/bail` variants** — five distinct calls behind one path, verified against `api-client.extracted.js`:

| Call | Body | Purpose |
|---|---|---|
| `GET /api/bail` | — | Own bail status (`bailMine`) |
| `GET /api/bail?friends=1` | — | Friends who could post bail (`bailFriends`) |
| `POST /api/bail` | `{action: "ask", to, amount}` | Ask a friend to post bail (`bailAsk`) |
| `POST /api/bail` | `{action: "pay", id}` | Pay an existing bail request (`bailPay`) |
| `POST /api/bail` | `{action: "visit", to, item?}` | Visit someone in a cell; `item` is an optional gift (`cellVisit`) |

Field notes: `to` is a player id, `amount` is the requested sum, `id` is a bail-request id returned by the `GET`, and `item` is omitted entirely when no gift is attached (the client spreads it conditionally, so the key is absent rather than `null`).

**Homes / knock system**

| Method | Path |
|---|---|
| GET | `/api/homes`, `/api/homes?map=1`, `/api/homes/:id` |
| POST / GET / DELETE | `/api/homes/:id/knock` |
| POST | `/api/knock` `{guestId, ok}` |

**Sea · Government · Push**

| Method | Path | Body |
|---|---|---|
| GET / POST / DELETE | `/api/sea`, `/api/sea/:id` | — |
| GET | `/api/gov`, `?full=1` | — |
| POST | `/api/gov/run` | `{slogan, v: 2}` |
| POST | `/api/gov/vote` | `{candidate}` |
| POST | `/api/gov/policy` | `{policy}` |
| POST | `/api/gov/announce` | `{text}` |
| GET / POST / PATCH / DELETE | `/api/push` | `{subscription}` / `{endpoint}` / prefs |

---

## 6. Ads and payments

| Method | Path | Body |
|---|---|---|
| POST | `/api/wallet/checkout` | `{pack, currency}` |
| GET | `/api/wallet/pending` | — |
| GET | `/api/wallet/verify?checkout_id=` | — |
| GET / POST | `/api/ads` | `{slot, link, image, currency}` |
| DELETE | `/api/ads/:id` | — |
| GET | `/api/ads/verify?checkout_id=` | — |
| GET / PATCH | `/api/my-ads` | `{kind, id, image}` |

`checkout_id` implies a hosted-checkout provider (Paystack/Flutterwave-style). **No provider name or key appears in the client bundle** — checkout is created server-side and the provider page is external. Do not expect to find a client-side secret; if one existed it would be a bug worth reporting to `support@lagoslife.app`.

---

## 7. Telemetry

| Method | Path | Body |
|---|---|---|
| POST | `/api/client-error` | `{message, stack, where, url, uid, screen, build}` via `navigator.sendBeacon` |
| GET | `/api/origin` | — |
| GET | `/api/version` | — → `{ build }` |

The inline boot script also posts boot-failure telemetry (`where: "boot"`, `"asset"`, `"asset-rescue"`) and aggressively self-heals failed chunk loads (retry ladder up to 12 attempts, cache-busting reloads).

---

## 8. Confirmed live (unauthenticated)

| Endpoint | Status | Response |
|---|---|---|
| `GET /api/version` | 200 | `{"build":"1792451178"}` |
| `GET /api/auth/me` | 200 | `{"user":null,"now":1792481814134}` |
| `GET /api/captcha?for=signup` | 200 | `{"siteKey":"0x4AAAAAAFbzM3Xi2Yw74Dd2"}` (public Turnstile key) |
| `GET /api/daily` | 200 | `{"date":"2026-10-20","weekday":"Tuesday","weather":"sunny",...}` |
| `GET /api/players?q=test` | 401 | `{"error":"Please log in"}` |
| `GET /api/go?s=x` | 200 | HTML page (referral redirect) |

---

## 9. Anti-abuse summary

| Control | Evidence |
|---|---|
| Cloudflare Turnstile | Signup captcha, site key via `/api/captcha` |
| Edge/WAF | Non-JSON error → explicit "security check" message in client |
| Rate limiting | `429` + `retryIn`; client-side 2 s save floor and exponential backoff |
| Save concurrency | `409` with `base`/`replace` revision model; single-owner takeover code |
| Session binding | Cookie session; `409 code:"owner"` when the account is opened elsewhere |
| Message throttling | `canSend` cooldown returned by save |

---

## 10. Verified from a live capture

Source: `lagoslife.app.har` — 307 entries, **111 API calls**, **46 distinct method+path**, ~46-minute window, all `200`.

### 10.1 Correction: the static map was incomplete
My static scan covered only the **17 eagerly-loaded chunks**. The capture shows the game lazy-loads more code, exposing **16 endpoint families the static map missed**. The real surface is larger than §2–§8.

| Method | Path | Query / body | Response shape |
|---|---|---|---|
| GET | `/api/bank` | — | `{ok, bank, rates, snap, moves[]}` |
| POST | `/api/bank` | `{op, amount}` | `{ok, bank, rates, snap, move, money, moves[]}` |
| GET | `/api/company` | `?top` | `{top[]}` |
| GET | `/api/credibility` | — | `{on, score, tier, parts[], pen[], tips[], streak…}` |
| GET | `/api/cohabit/arrange` | `?pending` | `{waiting}` |
| GET | `/api/forbes` | — | `{at, total, top[50], mine, lv}` |
| GET | `/api/games` | `?mine`, `?city`, `?fame` | `{mine[], invites[], open[19], playing[12], city, champs, now}` |
| GET | `/api/jets` | — | `{jets[40]}` |
| GET | `/api/politics` | — | `{term, cabinet[], managers, offices, seats[]}` |
| GET | `/api/sponsors` | — | `{live[], frames, defs}` |
| GET | `/api/squads` | — | `{squads[], pins[]}` |
| GET | `/api/zuko` | `?at` | `{on, ready, found[], ticket, claimed, inside, …}` |
| GET | `/api/p2p-day` | — | `{on}` |
| GET | `/api/verified` | — | `{v: [[id, name]…]}` |
| GET | `/api/dev-games` | — | `{on, games[]}` |
| GET | `/api/hunt` | `?at` | `{day, clue, endsAt, found, nextReward, leaders…}` |
| GET | `/api/ads/:id/image` | `?v` | image |
| GET | `/api/sea/:id/image` | `?v` | image |
| GET | `/api/dev-games/img/:id/icon` | `?v` | image |
| GET | `/api/og-image/event/:slug` | `?v` | image |

### 10.2 `PUT /api/save` — confirmed
All **8** saves returned `200`. Envelope in steady state is exactly:

```
{ game, owner, base, build }      // fresh/replace only on first save
→ { ok: true, updatedAt, rk: [3 strings] }
```

The `game` object carries **~120 top-level keys**, including `money`, `bank`, `businesses`, `homes`, `cars`, `fleet`, `invest`, `bets`, `ledger`, `risk`, `cover`, `school`, `uni`, `courtLog`, `missions`, `rentOwed`, `tax`, `staff`.

> **Design observation:** the entire economy — balances, holdings, obligations — is uploaded by the client, with `base` used only for optimistic concurrency. Whether the server re-derives and validates these values cannot be established from a capture. I did not attempt to test it (that would mean writing forged state to a live account). If you ever confirm the server accepts arbitrary values, that is a genuine economic-integrity bug worth reporting to `support@lagoslife.app`.

### 10.3 `POST /api/world` — presence heartbeat
25 calls. Request: `{ins, location, look{body,style,skin,hair,…}, mood, activity, since, with, full, nb}`.
Response: `{now, online, load, cities, refinery, risk, econ, pol, tl, give, cred, soc, chd, homeExt, …}` — player presence plus **server-driven feature flags**.

### 10.4 New request shapes observed
| Call | Body | Response |
|---|---|---|
| `POST /api/send` | `{to, amount}` | `{ok, id, amount, fee}` — fee charged on transfers |
| `POST /api/messages` | `{to, body, cid}` | `{id}` — **`cid` is a client-generated idempotency key** |
| `GET /api/messages?with=&since=&voice=1` | — | `{unread, blocked, stream, messages[]}` |
| `GET /api/messages` | — | `{threads[85], streaks, pins[]}` |

### 10.5 Service worker
`sw.js` initiates 14 API calls — all image GETs (`/api/ads/:id/image`, `/api/sea/:id/image`). It is a **caching layer for media, not an auth or sync layer**. No background-sync of saves observed.

### 10.6 ⚠️ Unresolved: where is the auth credential?
Across all 307 entries of capture 1 **and all 148 entries of capture 2** (which includes a **successful login**):

- `Cookie` headers: **0**
- `Set-Cookie` headers: **0**
- non-empty `cookies` arrays: **0**

Yet authenticated endpoints (`/api/messages`, `/api/save`, `/api/players`, `/api/auth/me`) returned `200` with private data. So the session *was* authenticated while the credential is simply **absent from both exports**.

Capture 2 also shows headers Chrome would normally add that are missing (`Origin` and `Sec-Fetch-*` on a `PUT`). Together this strongly indicates the **exporter is stripping fields**, rather than the app authenticating some other way. A plain `curl` of `/api/auth/me` returns no `Set-Cookie`, so the cookie must be set at login and simply not recorded.

Until it is re-exported with sensitive data included — or read directly from **DevTools → Application → Cookies** — **cookie flags and CSRF posture remain unverified**.

### 10.7 Anti-abuse actually observed
- `cid` idempotency on outbound messages.
- `base` revision ordering on saves.
- No `409`/`429` in this capture — it was effectively a happy-path recording, so conflict and rate-limit behaviour is still only known from the client code.

### 10.8 REA on the HAR
`rea inspect-web-network-capture` initially **rejected** the file: 135 entries have `serverIPAddress: ""`, and REA's schema requires an IPv4 string. After deleting that field in a copy (`lagoslife.sanitized.har`), REA decoded all **307 records** and produced initiator stacks tying each call to its client function and chunk.

Chunk attribution for API calls:

| Chunk | Calls | Role |
|---|---|---|
| `3z0xxwyie_394.js` | 53 | core API SDK |
| `sw.js` | 14 | media caching |
| `3utzqlpdyth-8.js` | 11 | feature module |
| `10y-mvnpkru45.js`, `0ogjhi_wgujz_.js` | 4 each | feature modules |
| `264u3pmo14rxc.js`, `1-fvte_9fkzns.js` | 3 each | world loop / updater |
| 10 others | 1–2 each | feature modules |

### 10.9 Second capture — login flow and 7 more endpoints
`lagoslife.app.2.har`: 148 entries, 51 API calls, 17 non-2xx (all `304` except the login attempts), captured ~15 min after capture 1.

**Login** — `POST /api/auth/login` with `{username, password}`:

| Result | Body |
|---|---|
| Unknown username | **404** `{ "error": "We can't find a player called \"…\"…", "code": "no_user" }` |
| Success | **200** `{ ok: true, username }` |

> ⚠️ **Reportable:** the `no_user` code distinguishes *"account does not exist"* from *"wrong password"*. That is **username enumeration** — a low-to-medium severity issue that lets anyone test whether a handle is registered. Worth reporting, and easy to fix by returning one generic failure for both cases.

**Additional endpoints:**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/save` | — | `{game, updatedAt, now}` — `game` has **133** top-level keys |
| GET | `/api/save/backup` | — | `{backup}` |
| GET | `/api/save/old-account` | — | `{old}` |
| GET | `/api/wallet/pending` | — | `{topups[], ads[]}` |
| GET | `/api/live` | — | `{url}` — same-origin `/live` route |
| GET | `/api/levels` | — | `{on, now, today, week, weekEnds, xp, weekXp, streak{…}, alive, done, chestAt, spinAt, …}` |
| POST | `/api/levels` | `{op, xp}` | same shape, updated |
| POST | `/api/food-gift` | `{action, drinks}` | `{food[]}` |
| GET | `/api/family` | — | `{schools, partner, partners[], max: 4, incoming[], outgoing[], kids[], invites[], nights[], weddings[], care, kin[]}` |
| POST | `/api/family` | `{action, back}` | `{received[]}` |

`/api/auth/me` after login returns `{user: {id, username, name, admin, terms}, now}` — note `admin` is exposed client-side as a boolean (display-only; server must still enforce).

---

## 11. Still open

1. **Cookie flags** (`HttpOnly`/`Secure`/`SameSite`) and **CSRF** posture — blocked by the missing credential in §10.6.
2. **Server-side validation depth** on `PUT /api/save` — the main security question, and not answerable without deliberately tampering.
3. **`409` / `429` real payloads** — never triggered in this capture.
4. **Checkout provider** — `checkout_id` implies hosted checkout, but no provider name appears client-side.
5. **Authenticated shapes for lazy modules** (§10.1) — only list/read calls were captured; their POST/PATCH variants are unknown.

---

## 12. Reproduction

```bash
# 1. chunks referenced by the shell
curl -s https://lagoslife.app/ | grep -oE '/_next/static/chunks/[A-Za-z0-9._~-]+\.js' | sort -u

# 2. the client SDK lives in the chunk containing '["api",0,{'
#    search for  : e.s(["api",0,{me:()=>M("/api/auth/me")
#    fetch helper: async function M(e,t){...credentials:"same-origin"...}

# 3. public surface
curl -s https://lagoslife.app/api/version
curl -s https://lagoslife.app/api/auth/me
```

Extracted artifacts: `_api-client.js` (10.5 KB) and `_fetch-wrapper.js` in this folder.
