# Effro - Licensing & Editions (spec)

Status: **Implemented and on `main`.** This document is the design record, not
a plan. The build landed with the v0.12.x licensing work: see
`backend/licence_manager.py` (offline Ed25519 verification, edition and seat
logic), `backend/connectors.py` (the per-edition connector policy), the licence
and connector gates in `backend/main.py`, `/api/admin/licence`, the vendor
keygen tool at `scripts/licence_gen.py`, and the first-run setup token in
`routers/auth.py`. Where this document and the code disagree, the code wins.

It defines the licence and edition system that turns "auth works" into a
sellable enterprise product, and folds in the first-run setup token that closes
the claimable-instance hole. It builds on the auth layer: `EFFRO_AUTH_ENABLED`,
server-side sessions, OIDC SSO, admin user management, SMTP invites and GDPR.

---

## 1. Goals & non-goals

**Goals**
- A signed, **offline-verifiable** licence key carrying edition, expiry, seat
  count and customer identity.
- An `EFFRO_LICENCE_REQUIRED` gate that mirrors `EFFRO_AUTH_ENABLED`: off on the
  desktop/dev build (no-op), on for enterprise/hosted deployments.
- Two editions from one codebase (**Pro** and **Enterprise**), behaviour driven
  by a flag in the licence, never by code divergence.
- A humane expiry model: a grace period then **read-only**, never a hard stop,
  so a customer can always reach and export their data.
- Seat enforcement that never silently destroys data or locks people out.
- A one-time **setup token** seeded at provisioning that closes the
  "anyone can claim the admin account" and concurrent-setup-race holes.

**Non-goals (explicitly out of scope here)**
- Mid-term revocation of an issued offline key (see section 7 - not possible
  without a phone-home; accepted trade-off).
- DRM against a hostile self-host operator who patches the binary (see 2).
- Billing/checkout, the hosted web app, multi-tenant, SCIM (later phases).
- Per-area access control.

---

## 2. Design principles & trust model

- **Offline, no phone-home.** Verification is local against a baked-in public
  key. A licensed instance works fully air-gapped. (Matches the strategy doc.)
- **No new heavy dependency.** Use **Ed25519** via the already-bundled
  `cryptography` package (`cryptography.hazmat.primitives.asymmetric.ed25519`).
  No JWT/licensing library.
- **Honest-customer enforcement, not DRM.** A self-hosting customer controls the
  binary and could patch out the public key or the gate. Offline licensing
  deters casual/accidental misuse and encodes the contract; it is not a defence
  against a determined hostile operator. Enterprise relationships are
  contractual; this is acceptable and intentional.
- **Fail safe for the customer.** Every failure mode degrades to read-only (data
  reachable + exportable), never to a crash or data loss.
- **Mirror the auth design.** Same shape as `EFFRO_AUTH_ENABLED`: a call-time env
  flag, a synthetic "unlicensed local" context when off, real enforcement when
  on. Keep the gate in the FastAPI backend (where the auth gate already lives).

---

## 3. Flags & modes

### `EFFRO_LICENCE_REQUIRED` (new, mirrors `EFFRO_AUTH_ENABLED`)
- Read at **call time** from the environment (not import time), so tests/shell
  can toggle it. Truthy set = `1|true|yes|on`.
- **Off (unset/false)** - the desktop build and dev: licensing is a **no-op**.
  `licence_state()` returns a synthetic **unlicensed-local** context: edition =
  `pro`, unlimited seats, no expiry, state = `valid`. Nothing is gated. (Same
  spirit as the synthetic local admin when auth is off.)
- **On (true)** - enterprise/hosted (set in the Dockerfile, alongside
  `EFFRO_AUTH_ENABLED=true`): a valid licence is **required**; its edition,
  seats and expiry are enforced; a bad/missing licence drops the instance to the
  shared read-only state (section 6).

### Relationship to `EFFRO_AUTH_ENABLED`
- A licensed instance is inherently multi-user, so **`EFFRO_LICENCE_REQUIRED`
  implies `EFFRO_AUTH_ENABLED`**. If licence is required but auth is off, treat
  as a misconfiguration: log a loud warning and force auth on (or refuse to
  serve writes). Document that both flags go on together in the Dockerfile.
- Desktop: both unset. Pro-local, no login, no licence. Unchanged behaviour.

### Flag matrix
| `EFFRO_AUTH_ENABLED` | `EFFRO_LICENCE_REQUIRED` | Mode |
|---|---|---|
| unset | unset | Desktop: no login, unlicensed-local (Pro features, single user) |
| true | unset | Self-host multi-user, no licence enforcement (internal/testing) |
| true | true | **Enterprise/Pro deployment**: auth + licence enforced |
| unset | true | Misconfig -> warn + treat as auth-required |

---

## 4. Licence key format

### 4.1 Token
A compact, URL-safe, single-line token:

```
effro-lic-v1.<base64url(payload_json)>.<base64url(ed25519_signature)>
```

- `effro-lic-v1` - literal prefix + format version (bump on breaking change).
- `payload_json` - the canonical UTF-8 JSON of the claims (section 4.2),
  base64url without padding.
- `ed25519_signature` - Ed25519 signature over the exact `payload_json` bytes
  (the bytes that were base64url-encoded), base64url without padding.

Verification: split on `.`, check the prefix/version, base64url-decode the
payload, **verify the signature over the decoded payload bytes against the
baked-in public key**, then parse the JSON. Any failure -> invalid (section 6).

### 4.2 Claims (payload)
```jsonc
{
  "v": 1,                          // claims schema version
  "key_id": "lic_2026_ACME_001",   // unique id; for the customer's records only
  "customer_id": "acme-corp",      // stable org identifier
  "customer_name": "ACME Corp",    // display
  "edition": "enterprise",         // "pro" | "enterprise"
  "seats": 25,                     // max active users; null/absent = unlimited
  "issued_at": "2026-06-01",       // ISO date (UTC)
  "expires_at": "2027-06-01",      // ISO date (UTC), contract end
  "grace_days": 30                 // optional; read-only kicks in this many days after expiry (default 30)
}
```
- Unknown future claims are ignored (forward-compat).
- `seats`: a positive integer, or `null`/absent for unlimited.
- `edition`: anything other than `enterprise` is treated as `pro` (safe default).
- `grace_days`: optional non-negative integer; **defaults to 30** when absent.
  Drives the grace window length (section 7).
- Dates are date-only UTC; comparisons use end-of-day semantics (expiry is
  inclusive of `expires_at`).

### 4.3 Keys
- **Ed25519 keypair.** The **public** key is a constant baked into the backend
  (`licence_manager.PUBLIC_KEY`, raw 32 bytes / PEM). The **private** key lives
  ONLY in the vendor's offline key-generation tool and secret store - never in
  the repo, the image, or any customer artifact.
- Support a small list of public keys (current + next) to allow key rotation
  without breaking issued licences.

### 4.4 Vendor key-gen tool (vendor-internal, out of band)
- `scripts/licence_gen.py` (or a separate private tool): given the private key +
  the claim values, emits a token. Also a `keygen` mode to mint the Ed25519
  keypair. This is operator tooling, not shipped to customers.
- It NEVER ships in the PyInstaller bundle or the Docker image.

---

## 5. Licence loading, storage & admin surface

### 5.1 Sources (precedence, highest first)
1. **`app_settings['licence_key']`** - an admin-uploaded key (renewal without
   redeploy). Survives restarts.
2. **`EFFRO_LICENCE_KEY` env** - provisioning-time key.
3. **File** at `EFFRO_LICENCE_FILE` (default `<DATA_DIR>/licence.key`) - mounted
   secret.

On boot and on demand, `licence_manager.load()` reads the highest-precedence
source, verifies it, and caches the parsed context (with a short TTL so a newly
uploaded key takes effect immediately).

### 5.2 Admin API (require_admin)
- `GET /api/admin/licence` -> status object:
  ```jsonc
  {
    "required": true, "edition": "enterprise",
    "customer_name": "ACME Corp",
    "seats": 25, "seats_used": 18,
    "expires_at": "2027-06-01", "days_remaining": 142,
    "state": "valid",          // valid | grace | read_only
    "seat_state": "ok",        // ok | over_seat
    "valid_signature": true
  }
  ```
  Never returns the raw key.
- `PUT /api/admin/licence` `{ "key": "effro-lic-v1...." }` -> verify; on success
  store to `app_settings['licence_key']`, refresh the cache, return the new
  status. On invalid signature/format -> 400 with a clear message (does NOT
  change the stored key). This is the renewal path.

  Note: `PUT /api/admin/licence` and `GET` must remain reachable in the
  read-only state (section 6) so an expired instance can be renewed in place.

### 5.3 Frontend (admin)
- A **Licence** section (Settings, admin + licence-required only) showing the
  status object in calm copy (edition, seats used / total, expiry,
  days remaining), a paste-a-new-key field, and the grace/over-seat notices.
- A global **read-only banner** + a **renewal nudge** during grace (section 6),
  styled per brand (calm, no alarmist red, no em dashes).

---

## 6. Edition matrix (Pro vs Enterprise)

Edition is read from the verified licence (`pro` default). Each capability is
either **enforced by edition** (the backend refuses the disallowed action) or
**configured by the admin but gated by edition** (Enterprise unlocks the
control). When `EFFRO_LICENCE_REQUIRED` is off (desktop), treat as **Pro** with
everything user-controllable.

| Capability | Pro | Enterprise | Enforcement |
|---|---|---|---|
| **AI provider / endpoint** | User-configurable (BYOK), changeable in Settings | **Locked**. Resolution: the `EFFRO_AI_ENDPOINT` env var **takes precedence** (pinned at deploy, not changeable in-app even by an admin); if unset, the admin sets it **once** and it then locks. Non-admins never change it. | AI-config writes refused when env-pinned; admin set-once then locked; key hidden from non-admins |
| **Personal connectors** (per-user M365 / Google / Jira / GitHub / iCloud) | Available to each user | **Disabled** (or admin-managed only); the per-user OAuth connect flows are refused | Integration `config/auth/sync` endpoints return 403 by edition |
| **SSO (Entra OIDC)** | Optional; password login always available | **Required**: once SSO is configured, **password login is disabled** (login/setup password paths refuse); only `/auth/oidc/*` admits users | `login` + `set-password` gated; setup still password-based for the first admin |
| **Audit log** | On | **Always-on, non-disable**; retention not user-clearable | No "disable audit" control offered in Enterprise |
| **Domain allowlist** (SSO auto-provision) | n/a (SSO optional) | **Enforced**: SSO auto-provision only for emails in the admin-set allowed-domains list; others are refused | OIDC callback checks email domain before creating a user |
| **Controlled update channel** | Auto-update to latest (desktop) | **v1: auto-update simply disabled** (no separate release feed). Updates are deliberate/manual; no silent auto-update | Updater is a no-op in Enterprise; a separate channel/feed is deferred past v1 |
| **Self-service signup / user mgmt** | Self + admin | **Admin-only**: no self-signup; admin provisions everyone | Already admin-gated; Enterprise removes any self-signup affordance |
| **Member self-export** | **On** by default | **Off** by default, admin-toggleable (a cap: `member_self_export`) | Export endpoint checks the cap; default on in Pro, off in Enterprise; admins always export |
| **Browser-tab launch path** | Allowed (dev convenience) | **Disabled** (`launch.vbs`/tab path not a product path) | Not shipped/enabled in Enterprise packaging |
| **Seat limit** | Per licence | Per licence | Section 8 |

Implementation shape: a single `edition_caps(ctx)` helper returns a capability
object; routers/middleware consult it. Capabilities are derived from
`edition` + admin config, in one place, so the matrix is auditable.

> Some rows (locked AI, connectors-off, domain allowlist) need new admin config
> keys (e.g. `enterprise_ai_locked`, `sso_allowed_domains`); the licence sets
> the edition, the admin sets the values, and the gate enforces the combination.

---

## 7. Expiry, grace & renewal

### 7.1 Timeline
```
issued_at .............. expires_at .......... expires_at + 30d ........>
        VALID                |     GRACE (30d)        |     READ-ONLY
   full function             | full function + banner | writes blocked
```
- **VALID**: `now <= expires_at`. Full function (subject to edition + seats).
- **GRACE**: `expires_at < now <= expires_at + grace_days` (the `grace_days`
  licence claim, **default 30** when absent; see 4.2).
  Full function, plus a persistent, calm **renewal banner** ("Your licence
  expired on <date>. Renew within N days to avoid read-only mode."). This is the
  only "expired but still writable" window.
- **READ-ONLY**: `now > expires_at + 30d` (over-grace). The shared restricted
  state (section 6 of behaviour below).

### 7.2 Renewal
- The customer receives a **new** key (new `expires_at`, possibly new
  `seats`/`edition`), pastes it via `PUT /api/admin/licence` (reachable even in
  read-only), and the instance returns to VALID immediately. No redeploy.
- A renewed key with different seats is handled per section 8.

### 7.3 Offline keys cannot be revoked mid-term (explicit)
Because verification is **offline with no phone-home**, an issued key is valid
until its `expires_at` and **cannot be revoked or downgraded before then**.
There is no revocation list and no kill switch. Consequences and mitigations:
- Keep terms **short** (annual) so the maximum exposure is one term.
- The **contract** governs misuse, not the software.
- If true mid-term revocation is ever required, it needs an **online check**
  (optional periodic licence-server ping with cached-offline fallback) - a
  deliberate future addition, explicitly out of scope here.

---

## 8. Seat enforcement

### 8.1 Definition
- `seats_used` = count of **active** real users (`User.is_active == true`).
  Password and SSO users both count. The synthetic local admin (auth off) does
  not count. `seats` from the licence is the maximum; `null`/absent = unlimited.

### 8.2 Enforcement points (block BEFORE adding/activating)
- `POST /api/admin/users` (create), `PATCH .../users/{id}` setting
  `is_active=true` (reactivate), and the **OIDC callback** auto-provisioning a
  new SSO user: if the action would make `seats_used > seats`, **refuse** with a
  clear 4xx ("Seat limit reached (N of N). Add seats or deactivate a user.").
  For SSO, the user is shown a friendly "no seats available, contact your admin"
  page rather than a silent failure.
- First-admin **setup** always succeeds (counts as seat 1; setup only runs when
  there are zero users, so it cannot exceed any sane seat count >= 1).

### 8.3 The renewed-key-with-fewer-seats case (must not lock people out)
Scenario: 20 seats / 20 active, renewed at 10 seats.
- **Never auto-deactivate or delete users, and never block existing users.**
  Forcibly removing access is destructive and hostile to data access.
- Instead the instance enters a **soft `over_seat` state** (separate from
  read-only): `seats_used > seats`.
  - Existing active users continue to work normally (read AND write).
  - **No new users can be created or reactivated, and SSO auto-provisioning is
    paused**, until `seats_used <= seats`.
  - The admin sees a persistent, specific notice: "You have 20 active users but
    10 seats. Deactivate 10 users to return to compliance." (Deactivation is the
    admin's deliberate choice, with the GDPR-safe last-admin guard still
    applying.)
- `over_seat` is **orthogonal to** the expiry/read-only state: a VALID but
  over-seat instance is still fully writable for existing users; it only gates
  growth. (Read-only is driven solely by expiry/signature, section 9.)
- `GET /api/admin/licence` surfaces `seat_state: "over_seat"` + the numbers.

---

## 9. The single shared read-only state

### 9.1 Triggers (when `EFFRO_LICENCE_REQUIRED` is on)
All of the following collapse to **one** read-only state:
1. **Over-grace**: `now > expires_at + 30d` (the colloquial "expired").
2. **Invalid signature / malformed token** (tampered or corrupt key).
3. **Missing / unreadable** licence when one is required.

(`grace` is NOT read-only - it is full-function-with-banner. `over_seat` is NOT
read-only - section 8.)

### 9.2 Behaviour
A `licence_gate` (HTTP middleware, sibling of the existing `auth_gate`) enforces:
when the state is read-only, **all mutating requests are refused** and only a
small allowlist is permitted.

- **Blocked**: every `POST`/`PUT`/`PATCH`/`DELETE` under `/api/...` (writes), with
  HTTP **402 Payment Required** + a stable body
  `{ "detail": "...", "code": "licence_read_only" }`.
- **Allowed regardless** (so the customer keeps access + can renew):
  - `GET` requests (read the workspace),
  - `GET /api/account/export` (data portability - they can always get their
    data out),
  - `GET`/`PUT /api/admin/licence` (view status + paste a renewal key),
  - all `/api/auth/*` (log in / out / me / sessions),
  - `GET /api/health`, and the static SPA + `/uploads` reads.
- Ordering: `auth_gate` runs first (must be signed in); then `licence_gate`
  (signed-in users may read/export but not write); `health` and the public auth
  allowlist bypass both, exactly as today.

### 9.3 Frontend
- One shared **read-only screen/banner**: "This workspace is read-only because
  the licence has expired (or is invalid). You can still read and export your
  data. An admin can renew it in Settings -> Licence." Calm, brand-correct.
- Admins additionally see the paste-a-key field inline.

---

## 10. Setup token (folded in)

### 10.1 Problem this closes
Before this shipped, `/auth/setup` was open to whoever hit a fresh instance first, and
two concurrent distinct-email setups can both create an admin (the known race).
For a provisioned enterprise instance, the admin account must be claimable
**only by the purchasing customer**.

### 10.2 Mechanism
- **Provisioning seeds a one-time setup token.** When `EFFRO_LICENCE_REQUIRED` is
  on and the users table is empty, on first boot the backend generates a random
  token (`secrets.token_urlsafe(32)`), stores it in `app_settings['setup_token']`,
  and **surfaces it to the operator** (printed to stdout/container logs at boot,
  and/or returned by the provisioning script, and/or delivered alongside the
  licence). It is shown to the operator exactly once at provisioning.
- **`/auth/setup` requires the token** when `EFFRO_LICENCE_REQUIRED` is on:
  body gains `setup_token`; the endpoint compares it (constant-time) to the
  stored token. Wrong/missing token -> **403**. On success: create the first
  admin **and delete the stored setup token in the same transaction** (single
  use), so setup closes permanently.
- **Desktop / licence-off**: no token required (preserves the current
  zero-friction first-run). Token is only enforced when licence is required.

### 10.3 Why this also fixes the race
- The token is **single-use and consumed atomically** with the first-admin
  insert. Concurrent setup attempts all present the same token, but only the
  first transaction to commit consumes it; the others find the token gone (or
  the users table non-empty) and get 403 / "already set up". This removes the
  distinct-email duplicate-admin window without needing DB-level locking.
- Combined with the existing email-UNIQUE 409 handling, first-admin creation is
  now both **authorised** (token) and **race-safe** (single-use consume).

### 10.4 Setup status
- `GET /api/auth/setup/status` gains (when licence-required) a hint that a token
  is needed, so the frontend setup page can show a "paste your setup token"
  field. It must NOT leak the token itself.

---

## 11. Backend surface (names & contracts; no code yet)

- `licence_manager.py`:
  - `PUBLIC_KEYS` (baked-in Ed25519 public key(s)).
  - `licence_required() -> bool` (reads `EFFRO_LICENCE_REQUIRED`).
  - `parse_and_verify(token) -> ctx | None` (signature + claims).
  - `current(db) -> LicenceContext` (load from sources 5.1, cache; synthetic
    unlicensed-local when not required).
  - `state(ctx, now) -> "valid"|"grace"|"read_only"`.
  - `seats_used(db) -> int`, `seat_state(ctx, db) -> "ok"|"over_seat"`.
  - `edition_caps(ctx) -> Capabilities`.
- `dependencies.py`: `require_seat_available(db)` (used by create/activate/SSO),
  `require_capability(name)` helpers for routers.
- `main.py`: a `licence_gate` HTTP middleware (sibling of `auth_gate`) for the
  read-only write-block + allowlist.
- `routers/admin.py`: `GET`/`PUT /admin/licence`.
- `routers/auth.py`: setup-token check in `/auth/setup`; password-login disabled
  under Enterprise-forced-SSO; OIDC callback domain-allowlist + seat check.
- Storage: `app_settings` keys `licence_key`, `setup_token`,
  `sso_allowed_domains`, `enterprise_ai_locked`, update-channel - no new tables.
  Seat counting reuses the `users` table.

## 12. Verification plan (per the repo's no-desktop loop)
- Unit: sign with a TEST private key, verify with the matching baked test public
  key; tamper one byte -> invalid; wrong-prefix/version -> invalid.
- State machine: inject `now` around `expires_at` and `+30d` -> valid/grace/
  read_only; invalid-signature + missing -> read_only.
- Edition matrix: TestClient asserts each Enterprise lock (AI write 403,
  connector 403, password-login disabled when SSO forced, domain allowlist on
  SSO callback).
- Seats: create up to N ok, N+1 refused; SSO provision refused at limit; renewed
  key with fewer seats -> over_seat, existing users still write, new blocked,
  no auto-deactivation.
- Read-only gate: writes 402, reads + export + `PUT /admin/licence` + auth + health allowed.
- Setup token: licence-on setup without token 403, wrong token 403, correct
  token creates admin + consumes token; second attempt 403/already-set-up;
  licence-off setup needs no token.
- Bundle: ensure `cryptography` Ed25519 is already in the PyInstaller bundle
  (it is, via Fernet) - add `licence_manager` to hiddenimports.

## 13. Migration & back-compat
- Additive only. `EFFRO_LICENCE_REQUIRED` defaults off -> desktop and existing
  auth-on Docker are unchanged (Pro, unlimited, no expiry, no setup token).
- New `app_settings` keys are created on demand; no schema migration needed.
- Enable per deployment by setting `EFFRO_LICENCE_REQUIRED=true` (+ a licence
  source) in the enterprise Dockerfile/compose, next to `EFFRO_AUTH_ENABLED=true`.

## 14. Decisions (locked 2026-06-09; previously open)
1. **Locked AI endpoint**: `EFFRO_AI_ENDPOINT` env var **takes precedence** (pinned
   at deploy, unchangeable in-app); if unset, the admin sets it **once** and it
   then locks. (Reflected in section 6.)
2. **Member self-export**: **off by default in Enterprise, on by default in Pro**,
   exposed as an admin-toggleable capability (`member_self_export`). Admins can
   always export. (Reflected in section 6.)
3. **Controlled update channel (v1)**: **auto-update is simply disabled in
   Enterprise** - no separate release feed/channel in v1; the updater is a no-op
   and updates are deliberate. A dedicated channel is deferred past v1.
   (Reflected in section 6.)
4. **Grace length**: a licence claim **`grace_days`, defaulting to 30** when
   absent. (Reflected in sections 4.2 and 7.)

These four are settled; implementation on `main` proceeds against them.
