# Jira Cloud — Atlassian OAuth app registration (one-time setup)

Before Effro can read your Jira issues, you need to register an OAuth 2.0
app in the Atlassian developer console. It's free, takes about 5 minutes,
and only has to be done once.

## What you'll end up with

Two values to paste into Effro:
1. **Client ID** — identifies your Atlassian OAuth app
2. **Client secret** — a credential for that app (stored Fernet-encrypted)

## Step-by-step

### 1. Open the Atlassian developer console

Go to **[developer.atlassian.com](https://developer.atlassian.com)** and
sign in with your Atlassian account. Click **Create** → **OAuth 2.0 integration**.

### 2. Fill in the basic details

- **App name:** `Effro` (or anything you'll recognise)
- **App description:** optional
- Click **Create**

### 3. Add OAuth 2.0 (3LO)

On your new app's page, go to **Authorization** in the left sidebar.
Click **Add** next to **OAuth 2.0 (3LO)**.

- **Callback URL:** `http://localhost:8000/api/jira/auth/callback`
  *(Must be exact — `http`, not `https`, port `8000`, full path.)*

Click **Save changes**.

### 4. Add the required scopes

Go to **Permissions** in the left sidebar.

Click **Add** next to **Jira API**, then click **Configure**.

Enable the following scopes:
- `read:jira-user` — read your Jira profile
- `read:jira-work` — read issues, sprints, projects

Click **Save changes**.

### 5. Copy the credentials

Go to **Settings** in the left sidebar.

You'll find:
- **Client ID** — copy this
- **Secret** — click **Create a new secret**, then copy the value immediately
  (it's only shown once)

### 6. Paste into Effro

1. Open Effro → **Settings → Integrations → Jira**
2. Paste the **Client ID** and **Secret** → click **Save config**
3. Click **Sign in with Atlassian**
4. Consent to the two permissions in your browser
5. The settings page flips to "Connected as …"

The first sync runs immediately. After that, Effro pulls three sets of
issues every 30 minutes automatically:
- **Assigned to you** — open issues where you're the assignee
- **Watching** — issues you're watching (that aren't yours)
- **Current sprint** — all open items in the active sprint

---

## Troubleshooting

**"No Atlassian Cloud sites accessible"** — your app needs to be associated
with at least one Jira Cloud site. After creating the app, make sure you've
completed the consent step by clicking "Sign in with Atlassian" so the app
can request access to your sites.

**Callback URL mismatch** — the URL in Atlassian's console must be exactly
`http://localhost:8000/api/jira/auth/callback`. Check for trailing slashes,
`https` vs `http`, or a different port number.

**"invalid_client"** — the secret may have been copied incorrectly or
rotated. Go back to the Atlassian developer console → Settings, create a
new secret, and update Effro's config.

**Sync runs but no signals appear** — check the Settings → Jira card for
the last-synced timestamp. If it's stale, try "Sync now". If issues still
don't appear, check your JQL — if you have no open assigned issues and no
active sprint, all three queries will return empty.

---

## Privacy notes

- Effro requests **read-only** Jira scopes. It cannot create, update, or
  delete issues.
- Your client secret is stored Fernet-encrypted in the local SQLite
  database using the same encryption key as your Nextcloud backup credentials.
- To revoke access: disconnect in Effro's settings, then go to
  [id.atlassian.com/manage-profile/apps](https://id.atlassian.com/manage-profile/apps)
  and remove the app.
