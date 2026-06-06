# Building the Effro. desktop app

This document covers the **desktop** build path - packaging Effro. as a
self-contained Windows / macOS / Linux app via Tauri v2 + PyInstaller. The
**Docker** deployment path is unchanged and unaffected by anything here; see
the project root README for that.

---

## TL;DR - local Windows build

```powershell
# One-time setup (see "Prerequisites" if any of these fail):
py -m pip install -r backend/requirements.txt
npm install -g @tauri-apps/cli@^2
npm ci --prefix frontend

# Each build:
npm run build      # = python scripts/build-backend.py && tauri build
```

Output:

```
src-tauri/target/release/bundle/nsis/Effro_1.0.0_x64-setup.exe   # 27 MB NSIS installer
src-tauri/target/release/effro.exe                                # bare exe (no installer)
```

The NSIS installer runs without admin elevation and installs to
`%LOCALAPPDATA%\Programs\Effro\` so the in-app updater can write to the
install directory without UAC. We no longer ship the MSI; see
[Why no MSI?](#why-no-msi) below.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | **1.94** (pinned) | `src-tauri/rust-toolchain.toml` auto-installs this via rustup |
| Python | 3.11 | Earlier 3.x probably fine; we pin 3.11 in CI |
| Node | 20 LTS | For frontend + Tauri CLI |
| MSVC Build Tools 2022 | Latest | Windows only - provides `link.exe` and the Win SDK |
| Tauri CLI | 2.11+ | `npm i -g @tauri-apps/cli@^2` (do **not** use `cargo install tauri-cli` - see footnote) |

### Why not `cargo install tauri-cli`?

Rust 1.95.0 stabilised `std::ops::Receiver`, which broke older crates (`shlex`,
`syn`, `serde_core`, `memchr`, …) that wrote `Self::Target` inside `Deref` impls
without disambiguation. The npm package ships a **prebuilt** binary so the host
toolchain version doesn't matter. When the ecosystem catches up to 1.95 we can
drop the `rust-toolchain.toml` pin, but `npm i` is still simpler so we'd keep
it anyway.

### Windows Defender exclusions

Defender's real-time scanner aggressively reads `.rmeta` files that rustc is
still writing, corrupting them and producing weird build failures -
`STATUS_STACK_BUFFER_OVERRUN`, "only metadata stub found for `core`", random
`Debug not implemented` errors on `#[derive(Debug)]` types. The symptom is that
**different crates fail on each rebuild**.

Add exclusions once (admin PowerShell):

```powershell
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.cargo"
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.rustup"
Add-MpPreference -ExclusionPath "$PWD\src-tauri\target"
Add-MpPreference -ExclusionProcess "rustc.exe"
Add-MpPreference -ExclusionProcess "cargo.exe"
Add-MpPreference -ExclusionProcess "link.exe"
```

CI runners don't have this problem - Defender isn't real-time on GitHub
Actions hosted runners.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Effro_1.0.0_x64-setup.exe                                   │
│  installs to                                                │
│  %LOCALAPPDATA%\Programs\Effro\                             │
│    ├── effro.exe                  (Tauri Rust shell)        │
│    ├── resources/                                           │
│    │   └── binaries/                                        │
│    │       └── effro-backend-x86_64-pc-windows-msvc/        │
│    │           ├── effro-backend.exe   (PyInstaller stub)   │
│    │           └── _internal/          (Python + deps)      │
│    └── WebView2Loader.dll, etc.                             │
└─────────────────────────────────────────────────────────────┘

At runtime:
  effro.exe (Rust)
    ├── finds a free TCP port
    ├── resolves resource_dir() → binaries/effro-backend-…/effro-backend.exe
    ├── spawns it with --port N --data-dir %APPDATA%\com.effro.app
    ├── polls http://127.0.0.1:N/api/health for up to 30s
    ├── navigates the WebView2 window to that URL once 200 OK
    ├── on close → hide to tray (backend keeps running)
    └── on quit → kill the sidecar
```

The FastAPI backend serves the React SPA from its own `StaticFiles` mount.
There's no separate frontend devserver in the bundled app - it's the same
single-binary surface that Docker ships.

### Why `bundle.resources`, not `externalBin`?

`externalBin` only ships single files. PyInstaller `--onedir` produces an
`.exe` + `_internal/` folder pair (vs `--onefile`, which we avoid because
of AV false positives and per-launch tempdir extraction). So we ship the
whole onedir folder as a resource and the Rust shell invokes the exe by
the resolved resource path.

---

## Step-by-step build

The `npm run build` script chains the two steps below - these are mostly
useful for debugging.

### 1. `python scripts/build-backend.py`

What it does:

1. Sanity-checks that the runtime deps (`uvicorn`, `fastapi`, `sqlalchemy`,
   `anthropic`, `apscheduler`) are importable in the current Python. Bails
   loudly if not - saves you from shipping an empty PyInstaller bundle.
2. `npm run build` inside `frontend/` → static React app in `frontend/dist/`.
3. `pyinstaller backend/effro-backend.spec --noconfirm --clean` →
   `dist/effro-backend/` (exe + `_internal/` folder, ~45 MB total).
4. Copies that folder to `src-tauri/binaries/effro-backend-{rust-triple}/`
   where `{rust-triple}` is read from `rustc -vV`.

### 2. `tauri build`

What it does:

1. Re-runs `npm run build` inside `frontend/` (Tauri's `beforeBuildCommand`).
2. `cargo build --release` for `src-tauri/` → `effro.exe`.
3. Bundles `effro.exe` + frontend assets + the `src-tauri/binaries/…` folder
   + WebView2 bootstrapper into an NSIS installer and an MSI.

The first invocation downloads WiX (for MSI) and NSIS into
`~/AppData/Local/tauri/`. Subsequent builds reuse them.

---

## Code-signing

The build produces **unsigned** binaries by default. They work fine for local
testing but trigger SmartScreen / Gatekeeper warnings for end users. For
public distribution, sign before uploading.

### Windows - Authenticode

**What you need:**

- A code-signing certificate from a CA Microsoft trusts. Options ranked by
  cost / hassle:
  - **OV (Organization Validated) certificate** - ~$200–400/yr (SSL.com, Sectigo, DigiCert). Cheaper, but SmartScreen takes a while to warm up reputation. Exportable to `.pfx`, so usable in CI.
  - **EV (Extended Validation) certificate** - ~$300–700/yr. Bypasses SmartScreen warnings immediately, but the private key lives on a **hardware token** (USB or HSM) which makes CI signing painful (most cloud HSMs require enterprise tier; SSL.com's eSigner cloud HSM is the most common workaround).
- A timestamp server URL (free): `http://timestamp.digicert.com` or `http://ts.ssl.com`.

**Local signing** (one-off, after `tauri build`):

```powershell
# Locate SignTool (ships with Windows SDK):
$signtool = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"

# Sign the bare exe AND each installer:
& $signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
    /f mycert.pfx /p $env:CERT_PASSWORD `
    "src-tauri\target\release\effro.exe" `
    "src-tauri\target\release\bundle\nsis\Effro_1.0.0_x64-setup.exe" `
    "src-tauri\target\release\bundle\msi\Effro_1.0.0_x64_en-US.msi"
```

**Tauri-native signing** (signs automatically as part of `tauri build`):

Add to `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "signCommand": "signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f %CERT_PATH% /p %CERT_PASSWORD% %1"
    }
  }
}
```

Then expose `CERT_PATH` (path to .pfx) and `CERT_PASSWORD` as env vars before
running `tauri build`.

### macOS - Developer ID + Notarization

Required for distribution outside the App Store. Without notarization the user
gets *"Effro.app can't be opened because Apple cannot check it for malicious
software."*

**What you need:**

- Apple Developer Program membership ($99/yr).
- A **Developer ID Application** certificate, exported as `.p12`.
- An app-specific password (https://appleid.apple.com → Sign-in and Security → App-Specific Passwords) **or** an App Store Connect API key.

**Environment variables** (Tauri picks these up automatically):

```bash
export APPLE_CERTIFICATE="$(base64 -i DeveloperID.p12)"
export APPLE_CERTIFICATE_PASSWORD="…"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarization - either app-specific password:
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

# …or API key (preferred for CI):
export APPLE_API_KEY="ABCDE12345"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY_PATH="/path/to/AuthKey_ABCDE12345.p8"
```

Then `tauri build` signs **and** submits for notarization in one shot. Add 5–10
minutes to the build for Apple's notary service to round-trip.

### Linux

Linux distributions don't have a built-in signature trust system the way
Windows / macOS do - AppImages run unsigned. Two practices worth knowing:

- **AppImage GPG signing**: embeds a GPG signature in the AppImage's offset
  table. Useful for verifying the publisher; `appimagetool` does it via
  `--sign`. Tauri doesn't drive this directly; sign post-build.
- **Distro packaging**: if you ever produce `.deb` or `.rpm`, sign those with
  `dpkg-sig` / `rpmsign` and publish a repo. Out of scope for now.

---

## Releasing

We use git tags + a GitHub Actions workflow (`.github/workflows/desktop-release.yml`).

```bash
# Bump version in:
#   - package.json
#   - src-tauri/Cargo.toml
#   - src-tauri/tauri.conf.json
# Then:
git tag v1.0.1
git push origin v1.0.1
```

The workflow:

1. Builds on `windows-latest` (and `macos-latest` / `ubuntu-latest` if you
   enable those matrix legs).
2. Signs if the relevant secrets are configured (skips silently if not).
3. Creates a draft GitHub Release with the bundles attached.
4. You review the draft and click **Publish**.

### Required GitHub secrets (all optional)

| Secret | Used for |
|--------|----------|
| `WINDOWS_CERTIFICATE` | base64-encoded `.pfx` for Authenticode |
| `WINDOWS_CERTIFICATE_PASSWORD` | password for the above |
| `APPLE_CERTIFICATE` | base64-encoded Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for the above |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: …` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarization (app-specific pw flow) |

Without these the build still produces unsigned bundles. You can add them
incrementally as you obtain certificates.

---

## Troubleshooting

### `ModuleNotFoundError: No module named 'uvicorn'` on first launch

Backend deps weren't installed in the Python that ran PyInstaller. Run
`py -m pip install -r backend/requirements.txt`. The build script now
fails up-front when this is the case, so you should see a clearer error
during build rather than at runtime.

### `error: only metadata stub found for rlib dependency core`

Windows Defender is corrupting rustc intermediates. Add the exclusions in
the **Prerequisites** section above.

### `cargo install tauri-cli` fails with weird trait errors

Use the npm CLI instead: `npm i -g @tauri-apps/cli@^2`. See the footnote in
**Prerequisites** for the underlying Rust 1.95 issue.

### Backend bundle is ~5 MB and the installed app fails immediately

You're bundling an empty stub because backend deps aren't installed. See the
first item above.

### "ERROR: script `backend\backend\run.py` not found"

You're on an old version of `backend/effro-backend.spec`. Pull latest - the
spec was anchored to `SPECPATH` in commit `0f6f168` so it works regardless of
CWD.

### Tauri build is super slow (15–20 min)

Cold cargo cache. Subsequent builds reuse `src-tauri/target/` and complete
in ~1 min for backend changes only, ~5 min for Rust shell changes.

### `effro-backend.exe` is left running after the app closes

On Windows, if the Rust shell crashes hard before its cleanup hook runs, the
sidecar can be orphaned. Kill it via Task Manager. This shouldn't happen in
the release build but is worth knowing for `tauri dev`.

---

## Data directory

The desktop app stores its SQLite database, attachments, and avatars under:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\com.effro.app\` |
| macOS | `~/Library/Application Support/com.effro.app/` |
| Linux | `~/.local/share/com.effro.app/` |

This is **separate from the Docker volume** - the desktop and Docker versions
do not share state. (If you want to migrate from one to the other, copy
`effro.db` and the `attachments/` and `avatars/` folders across.)
