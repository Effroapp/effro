# Windows code signing — Azure Trusted Signing (one-time setup)

Every fresh install of Trace currently trips Windows **Smart App Control**
and **SmartScreen** because the `.exe` is unsigned. This has bitten us on
v0.5.0 and v0.6.4 — and it will keep happening on every release until we
attach a real publisher signature to the installer.

The fix is **Azure Trusted Signing**: Microsoft's managed code-signing
service, where they hold the private key (in an HSM) and we ask their
service to sign each release. The cert chains to a Microsoft root, so
Smart App Control trusts it on first contact — no reputation grind, no
"unknown publisher" prompt.

This walkthrough is the **Azure side** of the setup. The GitHub Actions
workflow side (`.github/workflows/desktop-release.yml`) is already wired
to use the secrets below — it skips signing gracefully if they're absent,
so dev builds and forked PRs still work.

---

## What you'll end up with

Five values you'll paste into the repo's Actions secrets:

| Secret name | What it is |
| --- | --- |
| `AZURE_TENANT_ID` | GUID of the Azure AD tenant that owns the signing account |
| `AZURE_CLIENT_ID` | GUID of a **new** App Registration (NOT the Trace MS365 app reg) |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Regional URL, e.g. `https://eus.codesigning.azure.net/` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` | The name you give the Trusted Signing account |
| `AZURE_TRUSTED_SIGNING_CERT_PROFILE` | The name you give the certificate profile |

No client secret is stored anywhere — auth happens via GitHub's OIDC token
exchange, scoped to `refs/heads/main` of this repo only.

---

## Cost expectations

Two pricing tiers (pick at account creation):

- **Basic (consumption)** — flat **~$9.99 USD/month** with quotas, fine for
  this project's release cadence.
- **Premium (pay-as-you-go)** — **~$0.005 USD per signature** plus a small
  monthly base. Cheaper if you ship < 1 release/month, more expensive past
  that. The basic tier is the safer default here.

Pricing changes — confirm at <https://azure.microsoft.com/en-us/pricing/details/trusted-signing/> before committing.

---

## ⚠ Read this first: identity validation takes 3–7 business days

The single longest-pole step in this whole setup is **Identity Validation**.
Microsoft requires it before they'll issue a Public Trust certificate
profile, and the first time you do it they manually review your submission.
Plan **3–7 business days** between submitting the validation and being able
to sign anything.

Do step 2 (Identity Validation) *immediately* after step 1 (account
creation). Everything else can happen while you wait.

---

## Step-by-step

### 1. Create the Trusted Signing account

1. Sign in at **<https://portal.azure.com>**.
2. In the top search bar, type **"Trusted Signing Accounts"** and pick it.
3. Click **+ Create** at the top.
4. Fill in:
   - **Subscription:** your personal or work subscription.
   - **Resource group:** create a new one, e.g. `trace-signing-rg`.
   - **Trusted Signing Account name:** something memorable, e.g.
     `trace-signing`. **Write this down** — it's the
     `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` secret later.
   - **Region:** pick the one closest to you. The signing endpoint URL
     depends on this — for example, *East US* → `https://eus.codesigning.azure.net/`,
     *West Europe* → `https://weu.codesigning.azure.net/`. **Write the
     endpoint URL down** — that's `AZURE_TRUSTED_SIGNING_ENDPOINT`.
   - **Pricing tier:** Basic (see "Cost expectations" above).
5. Click **Review + create**, then **Create**. Deployment takes ~1 minute.

### 2. Submit Identity Validation (the 3–7 day blocker)

This step proves to Microsoft you are who you say you are. **Do it now.**

1. Open the Trusted Signing account you just created.
2. In the left nav, click **Identity validation**.
3. Click **+ New identity validation**.
4. Pick **Individual** (for personal projects) or **Organization** (if
   signing on behalf of a company). For Trace as a single-developer
   project, **Individual** is the right choice.
5. Fill in your legal name, address, and contact email exactly as they
   appear on government ID. Mismatches are the #1 cause of rejection and
   restart the 3-7 day clock.
6. Submit. Status will sit at **In progress** until Microsoft reviews it.

While you wait, continue with steps 3–6 below — they don't depend on
validation completing.

> If validation gets rejected, the portal will email you with the reason.
> The most common fix is correcting an address mismatch and re-submitting.

### 3. Create the Certificate Profile (Public Trust)

Once identity validation is **Completed**, come back and:

1. In the Trusted Signing account, left nav → **Certificate profiles**.
2. Click **+ Create**.
3. Fill in:
   - **Certificate profile name:** e.g. `trace-public-trust`. **Write this
     down** — it's `AZURE_TRUSTED_SIGNING_CERT_PROFILE`.
   - **Certificate type:** **Public Trust**. (This is the one whose chain
     ends in a Microsoft root that Windows trusts out of the box. The
     alternatives — Test, Private Trust, VBS Enclave — won't pass Smart
     App Control on a stock Windows install.)
   - **Identity validation:** select the validation you submitted in
     step 2 (must show **Completed**).
4. Click **Create**. Profile is ready in ~30 seconds.

### 4. Note your Tenant ID

1. In the portal top search, type **"Microsoft Entra ID"** (formerly Azure
   Active Directory) and open it.
2. On the Overview page, copy **Tenant ID** — a GUID. That's
   `AZURE_TENANT_ID`.

### 5. Create the App Registration (separate from the MS365 one)

This is a **brand new** App Registration. Do NOT reuse the App Registration
that powers Trace's Microsoft 365 calendar integration — those are scoped
to user-facing OAuth and shouldn't have signing rights.

1. In Microsoft Entra ID, left nav → **App registrations** → **+ New
   registration**.
2. Fill in:
   - **Name:** `trace-signing-ci` (or similar).
   - **Supported account types:** **Accounts in this organizational
     directory only** (single tenant — this app is internal to CI, not
     user-facing).
   - **Redirect URI:** leave blank.
3. Click **Register**.
4. On the Overview page, copy **Application (client) ID** — that's
   `AZURE_CLIENT_ID`. (Again: this is the *new* signing app reg, not the
   Trace MS365 app.)

### 6. Add a federated credential for GitHub OIDC

This is what lets GitHub Actions authenticate as the App Registration
without storing a long-lived client secret. The credential is scoped so
**only pushes on `main` of `lukeogh/Trace`** can sign — fork PRs and
feature branches can't.

1. Still inside the new App Registration, left nav → **Certificates &
   secrets** → **Federated credentials** tab → **+ Add credential**.
2. Federated credential scenario: **GitHub Actions deploying Azure
   resources**.
3. Fill in:
   - **Organization:** `lukeogh`
   - **Repository:** `Trace`
   - **Entity type:** **Branch**
   - **GitHub branch name:** `main`
   - **Name:** `trace-main-branch` (any label works).
4. Click **Add**.

> Want to also sign from tags (e.g. `v*.*.*`) instead of just branch
> `main`? You can — add a second federated credential with **Entity type:
> Tag** and pattern `v*.*.*`. The current `desktop-release.yml` runs on
> tag pushes, so this is actually the more correct setting if you want
> the action to work on tag-triggered builds. Add both to be safe; they
> cost nothing.

**Important — the existing workflow triggers on tag pushes, not branch
pushes.** If you only add the `main` branch credential, the federated
auth will refuse to issue a token when the workflow runs from a tag.
**Add a tag-scoped credential too** with pattern `v*.*.*`, entity type
`Tag`.

### 7. Grant the App Registration permission to sign

1. Back in your Trusted Signing account, left nav → **Access control
   (IAM)** → **+ Add** → **Add role assignment**.
2. Role: **Trusted Signing Certificate Profile Signer**.
3. Assign access to: **User, group, or service principal**.
4. Members: search for your app registration name (`trace-signing-ci`)
   and select it.
5. Review + assign.

Without this, the workflow will authenticate but get 403s on every sign
request.

---

## After Azure: add the secrets to GitHub

Once all five values are in hand (and identity validation is **Completed**):

1. Open <https://github.com/lukeogh/Trace/settings/secrets/actions>.
2. Click **New repository secret** and add each of:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_TRUSTED_SIGNING_ENDPOINT`
   - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
   - `AZURE_TRUSTED_SIGNING_CERT_PROFILE`
3. Merge the signing PR.
4. Cut the next release tag — the workflow will sign, regenerate the
   updater `.sig`, verify the chain back to Microsoft, then upload.

---

## How to verify a release was actually signed

After a tagged release runs through CI:

1. Download the `.exe` from the GitHub release page.
2. Right-click → **Properties** → **Digital Signatures** tab.
3. You should see a signature; double-click it and **View Certificate**.
4. The cert chain should end at a Microsoft root (e.g. *Microsoft
   Identity Verification Root Certificate Authority*).

Smoke test on a fresh Windows install: download, double-click — you
should get the normal UAC prompt, **not** the "Windows protected your PC"
blue dialog. Smart App Control should silently accept it.

---

## Troubleshooting

**"AADSTS70021: No matching federated identity record found"** — the
GitHub Actions run isn't matched by any federated credential. Common
causes: missing the tag-scoped credential (step 6), wrong branch/tag
pattern, or a typo in the org/repo name. Re-check the values in the
portal exactly match `lukeogh/Trace`.

**Signing succeeds but `signtool verify /pa` fails** — usually means the
cert profile is **Test** or **Private Trust** instead of **Public Trust**.
Recreate the profile (step 3) with the right type.

**Sig action fails with "Forbidden"** — the App Registration is missing
the *Trusted Signing Certificate Profile Signer* role on the account
(step 7).

**Identity validation rejected** — Microsoft will email the reason.
Almost always an address/name mismatch with the government ID you used.
Re-submit; the 3-7 day clock restarts.
