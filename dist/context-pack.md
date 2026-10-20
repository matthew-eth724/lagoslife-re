# Lagos Life — context pack

Build **1792451178** · captured 2026-10-20. If `/api/version` returns a different build, treat this as stale.

## Rules

- Analysis was authorised on the owner's own account. Do **not** tamper with saves, forge game state, or test F-02 against a live account.
- Confidence labels: `confirmed-live` (seen in a capture), `static-only` (present in the client SDK, never observed), `doc-only`.
- Cite IDs (`F-01`, `EP-004`) and keep the confidence label attached to the claim.

## Model in one paragraph

Next.js client + JSON API on the same origin behind Cloudflare. Auth is a session cookie (`ll_session`, HttpOnly/Secure/SameSite=Lax); no bearer token, no CSRF token, no CORS. The client is authoritative for game state: it uploads the whole `game` object on `PUT /api/save` with the revision it edited (`base`); `409` means conflict or ownership takeover, `429` carries `retryIn`. Real-time is polling with `since` cursors, not WebSocket. Registration is Turnstile-gated.

## Endpoints

### auth
- `POST /api/auth/age-appeal` — _input unverified_
- `POST /api/auth/delete` — _input unverified_
- `GET /api/auth/email`
- `POST /api/auth/email` — _input unverified_
- `GET /api/auth/email/verify`
- `POST /api/auth/email/verify` — _input unverified_
- `POST /api/auth/forgot` — _input unverified_
- `POST /api/auth/lock` — _input unverified_
- `POST /api/auth/login` — 404 {code:'no_user'} for unknown handle — username enumeration (F-01). — _public, input unverified_
- `POST /api/auth/logout` — _input unverified_
- `POST /api/auth/logout-all` — _input unverified_
- `GET /api/auth/me` — 200 with {user:null} when logged out, not 401. Exposes `user.admin`. — _public_
- `POST /api/auth/password` — _input unverified_
- `POST /api/auth/profile` — _input unverified_
- `POST /api/auth/recovery` — _input unverified_
- `POST /api/auth/register` — Turnstile-gated; captcha token required. — _public, input unverified_
- `POST /api/auth/reset` — _input unverified_
- `GET /api/auth/security`
- `POST /api/auth/security` — _input unverified_
- `POST /api/auth/terms` — _input unverified_
- `POST /api/auth/ticket` — _input unverified_
- `POST /api/auth/username` — _input unverified_
- `GET /api/captcha` — Returns the public Turnstile site key. — _public_
- `GET /api/referrals`

### billing
- `POST /api/wallet/checkout` — _input unverified_
- `GET /api/wallet/pending`
- `GET /api/wallet/verify` — Mutating GET: verifies a checkout. Reachable cross-site via top-level navigation under SameSite=Lax.

### civic
- `GET /api/company`
- `GET /api/credibility`
- `GET /api/dev-games`
- `GET /api/dev-games/img/:id/icon`
- `GET /api/forbes`
- `GET /api/games`
- `GET /api/gov`
- `POST /api/gov/announce` — _input unverified_
- `POST /api/gov/policy` — _input unverified_
- `POST /api/gov/run` — _input unverified_
- `POST /api/gov/vote` — _input unverified_
- `GET /api/jets`
- `GET /api/og-image/event/:slug`
- `GET /api/p2p-day`
- `GET /api/politics`
- `DELETE /api/push` — _input unverified_
- `GET /api/push`
- `PATCH /api/push` — _input unverified_
- `POST /api/push` — _input unverified_
- `GET /api/sponsors`
- `GET /api/squads`
- `POST /api/venue` — _input unverified_
- `GET /api/verified`
- `GET /api/zuko`

### economy
- `GET /api/bail` — Own bail status (bailMine); `?friends=1` lists friends who could post bail.
- `POST /api/bail` — Three variants by `action`: ask {to, amount}, pay {id}, visit {to, item?}. — _input unverified_
- `GET /api/bank`
- `POST /api/bank` — _input unverified_
- `GET /api/hunt`
- `POST /api/hunt` — _input unverified_
- `POST /api/invite` — _input unverified_
- `POST /api/send` — Money transfer; response carries `fee`. PIN may be required (F-03: float currency). — _input unverified_
- `GET /api/send-pin`
- `POST /api/send-pin` — _input unverified_
- `POST /api/visit` — _input unverified_

### property
- `GET /api/ads`
- `POST /api/ads` — _input unverified_
- `DELETE /api/ads/:id` — _input unverified_
- `GET /api/ads/:id/image`
- `GET /api/ads/verify` — Mutating GET: verifies an ad checkout. Same caveat as wallet/verify.
- `GET /api/cohabit/arrange`
- `GET /api/homes`
- `GET /api/homes/:id`
- `DELETE /api/homes/:id/knock` — _input unverified_
- `GET /api/homes/:id/knock`
- `POST /api/homes/:id/knock` — _input unverified_
- `POST /api/knock` — _input unverified_
- `GET /api/my-ads`
- `PATCH /api/my-ads` — _input unverified_
- `DELETE /api/sea` — _input unverified_
- `GET /api/sea`
- `POST /api/sea` — _input unverified_
- `DELETE /api/sea/:id` — _input unverified_
- `GET /api/sea/:id`
- `POST /api/sea/:id` — _input unverified_
- `GET /api/sea/:id/image`

### social
- `GET /api/block`
- `POST /api/block` — _input unverified_
- `POST /api/board/vote` — _input unverified_
- `GET /api/messages`
- `POST /api/messages` — `cid` is a client idempotency key — retries apply once. — _input unverified_
- `POST /api/messages/read` — _input unverified_
- `POST /api/messages/requests` — _input unverified_
- `POST /api/messages/voice` — _input unverified_
- `POST /api/report` — _input unverified_
- `GET /api/room`
- `POST /api/room` — _input unverified_
- `POST /api/say` — _input unverified_
- `POST /api/social` — _input unverified_

### state
- `GET /api/family`
- `POST /api/family` — _input unverified_
- `POST /api/food-gift` — _input unverified_
- `GET /api/levels`
- `POST /api/levels` — Client submits {op, xp}. Server did not blindly add it (16→30 on xp:26), but value is still client-originated (F-04). — _input unverified_
- `POST /api/party` — _input unverified_
- `GET /api/save` — Returns {game, updatedAt, now}; `game` has 133 top-level keys.
- `PUT /api/save` — Client-authoritative snapshot: {game, owner, base, build}. `base` detects concurrency, not plausibility (F-02). — _input unverified_
- `GET /api/save/backup`
- `GET /api/save/old-account`
- `GET /api/version` — Build stamp used for staleness checks. — _public_

### world
- `POST /api/client-error` — sendBeacon telemetry: {message, stack, where, url, uid, screen, build}. — _public, input unverified_
- `GET /api/daily` — Daily headline/weather; no auth required. — _public_
- `GET /api/go` — Referral redirect; returns an HTML page, not JSON. — _public_
- `GET /api/live`
- `GET /api/origin`
- `GET /api/players` — 401 {'Please log in'} without a session.
- `POST /api/world` — Presence beacon; response carries feature flags (cities, refinery, risk, econ, pol, tl, give, cred, soc, chd, homeExt). — _input unverified_

## Findings

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| F-01 | Username enumeration via login error code | medium | confirmed |
| F-02 | Client-authoritative economic state on save | high | unverified |
| F-03 | Floating-point currency | medium | confirmed |
| F-04 | Client-submitted XP in /api/levels | low-medium | unverified |
| F-05 | admin flag exposed to the client | low | confirmed |
| F-06 | CSRF posture | info | confirmed |
| F-07 | Verbose, input-echoing error text | low | confirmed |
| F-08 | Personal data in semi-public listings | low | confirmed |
| F-09 | Client build-id used as a trust signal | low | confirmed |
| F-10 | Long-lived session and device cookies | low | confirmed |
| F-11 | No __Host- cookie prefix | low | confirmed |
| F-12 | State-changing operations exposed as GET | low | confirmed |

Open the full report for evidence and recommendations.
