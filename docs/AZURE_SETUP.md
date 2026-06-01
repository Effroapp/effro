# Microsoft 365 — Azure app registration (one-time setup)

Before Effro can read your Outlook calendar, you need to register a small
Azure application — it's free, takes about 5 minutes, and only has to be
done once. Microsoft requires this as the security boundary: **you** decide
what app talks to your data, and Effro's Settings → Integrations → Microsoft
365 only ever sees the app credentials *you* paste in.

## What you'll end up with

Three values:
1. **Client ID** — a GUID identifying your Azure app
2. **Client secret** — a password for your Azure app (Effro stores it Fernet-encrypted)
3. **Tenant** — usually `common` (lets you sign in with personal or work accounts)

Paste those three into Settings → Integrations → Microsoft 365 in Effro, then click "Sign in with Microsoft." That's it.

---

## Step-by-step

### 1. Open the Azure portal

Go to **[https://portal.azure.com](https://portal.azure.com)** and sign in
with your Microsoft account (personal or work). If you've never done this,
Azure will walk you through creating a free subscription — no credit card
required for app registrations.

### 2. Navigate to App registrations

In the top search bar, type **"App registrations"** and click it. Then
click **+ New registration** at the top of the page.

### 3. Fill in the registration form

- **Name:** anything memorable. `Effro - personal` is fine.

- **Supported account types:** pick the option that matches who will sign in:
  - **Accounts in any organizational directory and personal Microsoft accounts** — most flexible. Use this if you want both personal and work accounts to work.
  - **Accounts in this organizational directory only** — work account only, single tenant.

  *(Effro's `tenant_id` field maps to your choice: `common` for the
  flexible option, your tenant GUID for single-tenant.)*

- **Redirect URI:** under "Web", paste:

  ```
  http://localhost:8000/api/microsoft/auth/callback
  ```

  *(That's the loopback URL Effro's backend listens on. If you've changed
  Effro's backend port, swap `8000` for yours.)*

- Click **Register**.

### 4. Copy the Client ID

You'll land on the app's Overview page. Under **Essentials**, find
**Application (client) ID** — it's a GUID that looks like
`a1b2c3d4-5678-90ab-cdef-1234567890ab`. **Copy it.** This is your
`Client ID`.

If you chose single-tenant, also copy the **Directory (tenant) ID** GUID
right below — that's your `Tenant` value. (If you chose the flexible
option, your tenant is just the word `common`.)

### 5. Create a Client Secret

In the left sidebar, click **Certificates & secrets** → **Client secrets**
tab → **+ New client secret**.

- **Description:** `Effro`
- **Expires:** pick a duration. Azure recommends 6 months for production
  apps; 24 months is fine for personal use. Whatever you pick, set a
  calendar reminder for a week before expiry — Effro will stop syncing
  silently when the secret expires.

Click **Add**. **Immediately copy the `Value`** (not the `Secret ID`). The
Value is shown ONCE and never again — if you navigate away without copying,
you'll need to create a new one.

That's your `Client Secret`.

### 6. Grant the API permissions

In the left sidebar, click **API permissions** → **+ Add a permission** →
**Microsoft Graph** → **Delegated permissions**.

Search for and tick each of:
- `Calendars.Read`  *(read your Outlook calendar)*
- `User.Read`  *(read your basic profile - Graph requires this for every app)*
- `offline_access`  *(let Effro refresh your token without re-signing-in)*

Click **Add permissions**.

You should see all three listed under "Configured permissions" with green
ticks. **No admin consent is needed for personal use** — these are all
delegated, user-consent permissions. Effro will ask for them when you sign
in.

### 7. Paste into Effro

Back in Effro:

1. Open **Settings → Integrations → Microsoft 365**
2. Paste the three values from steps 4 and 5
3. Click **Save config**
4. Click **Sign in with Microsoft** — your system browser opens
5. Sign in with your Microsoft account, consent to the permissions
6. The Effro settings page flips to "Connected as <you@example.com>"

The first calendar sync runs immediately. After that, the scheduler does
a fresh pull every 30 minutes; you can also force one with the **Sync
now** button.

---

## Troubleshooting

**"AADSTS50011: redirect URI mismatch"** — the URI in step 3 must match
*exactly*, including the protocol (`http://`, not `https://`) and port.
Edit it under Authentication in the Azure portal if you got it wrong.

**"invalid_client" during token exchange** — you copied the Secret ID
instead of the Secret Value. Go back to Certificates & secrets and copy
the Value column. (If your secret has expired, you'll need to create a
new one.)

**`{"detail":"Not Found"}` after clicking "Sign in with Microsoft"** —
the OAuth callback is being sent to a port that nothing is listening on.
As of **v0.6.2** Effro pins its backend to port 8000 to match the
redirect URI you registered. If you're on **v0.6.0 or v0.6.1** the
backend picks a random port and this exact symptom appears every time —
update to v0.6.2+ to fix.

If you're on v0.6.2+ and still see this, port 8000 was taken on your
machine when Effro started (Effro falls back to 8001-8010). Open the
DevTools Console (right-click → Inspect) and run:

```javascript
location.host
```

That tells you the actual port Effro is on. Then go to Azure portal →
your app → Authentication → edit the existing redirect URI to use that
port, save, and try Sign in again. Or quit whatever else is using
port 8000 and restart Effro.

**Sync runs but no signals appear** — open Effro's Signals page and click
"Sync now". Check the timestamp on Settings → Integrations → Microsoft 365
to confirm the last sync went through. If it shows an old time, your
token may have expired silently — disconnect and reconnect.

**"AADSTS70008: refresh token expired"** — happens roughly every 90 days
of inactivity. Disconnect and reconnect in Effro's Microsoft 365 settings.

---

## Privacy & permissions notes

- Effro only ever reads. There is no scope in the request list that allows
  write access to your calendar, mail, files, or anything else.
- The scopes requested are exactly the three above. You can audit them at
  any time in your Microsoft account at
  [account.live.com → Privacy → Apps and services](https://account.live.com)
  (personal account) or your work admin's access panel (work account).
- Your access + refresh tokens are stored Fernet-encrypted in Effro's
  local SQLite database. If your laptop is lost and you don't have full
  disk encryption, treat that database the same as your password manager.
- To revoke Effro's access entirely: disconnect inside Effro, then revoke
  the app's consent in your Microsoft account at the URL above.
