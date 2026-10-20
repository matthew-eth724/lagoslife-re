# Security and disclosure

This repository is an **independent analysis** of `lagoslife.app`. It is not affiliated
with, endorsed by, or authorised by the game's operator, and nothing here grants anyone
permission to test that service.

This file is not the vendor's security policy. It records the disclosure status of the
findings in this repository and the handling rules for anyone who uses it.

---

## Disclosure status

**As of 2026-10-20 the findings have not been reported to the vendor.** The repository is
private and unreported.

| Finding | Subject | Severity | Status |
|---|---|---|---|
| F-01 | Username enumeration on login | Medium | Not reported |
| F-02 | Client-authoritative economic state | High *if unvalidated* | Not reported, **unverified** |
| F-03 | Floating-point currency | Medium | Not reported |
| F-04 | Client-submitted XP | Low–Medium | Not reported, unverified |
| F-05 | `admin` flag exposed client-side | Low | Not reported |
| F-06 | CSRF posture | Info | Resolved — mitigated |
| F-07 | Verbose, input-echoing errors | Low | Not reported |
| F-08 | Personal data in semi-public listings | Low | Not reported |
| F-09 | Build id as a trust signal | Low | Not reported |
| F-10 | Long-lived session/device cookies | Low | Not reported |
| F-11 | No `__Host-` cookie prefix | Low | Not reported |
| F-12 | State-changing operations as `GET` | Low | Not reported |

If you publish this repository, you are making a disclosure decision. Reporting to the
vendor first, with a 90-day window before public release, is the conventional path.

## Handling rules

1. **Do not test F-02** — or any other finding — against a live account. Writing forged
   game state is out of scope and may breach the game's terms of service.
2. **Do not use this repository to access accounts, data, or funds you do not own.**
3. **No personal data.** Raw captures are excluded from version control; do not paste
   cookies, tokens, HAR files, message contents, or player identifiers into issues.
4. The empirical claims here describe a **specific build** (`1792451178`). Behaviour may
   differ on any other build.

## If you operate Lagos Life

Contact the maintainer through the support channel published on the game's site. On
request, this repository will be taken private, redacted, or corrected — including
removal of any finding the operator disputes or has since fixed.

## Reporting a problem with this repository

- **Corrections** (wrong endpoint, stale shape, broken link): open a normal issue.
- **Sensitive reports** (something here exposes a person, or you believe the analysis is
  itself harmful): use a private security advisory on this repository.
- Never include credentials, session cookies, or raw capture data in a report.

## What is not in this repository

- No HAR files, cookies, session tokens, passwords, or email addresses.
- No player handles, message contents, or account data.
- `data/state-keys.json` records **types and key names only**, never values.
- The extracted client JavaScript is public code served to every visitor.

## Timeline

| Date | Event |
|---|---|
| 2026-10-20 | Captures taken; analysis written; repository created |
| — | Vendor notification — *pending* |
| — | Public disclosure — *not planned* |
