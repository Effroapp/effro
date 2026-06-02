# Migrating from v0.4.x → v0.5.1

**TL;DR:** uninstall the old Trace once, install v0.5.1 once, never have to fight
Smart App Control or "Run as administrator" again. Your data isn't touched.

## Why this is a one-time chore

Versions 0.2 → 0.4 installed to `C:\Program Files\Trace`, the system-wide
location. That's why the v0.4.0 → v0.5.0 in-app update couldn't actually
replace the binaries: Tauri's auto-updater runs as your normal user, has no
UAC elevation, and Windows silently refuses to write to `C:\Program Files`.
The updater dialog reported success but no files changed - you'd restart and
land back on the old version.

v0.5.1 changes the installer to **per-user** mode (NSIS `currentUser`). The
app lives in `%LOCALAPPDATA%\Programs\Trace\`, which your user account owns,
so every future in-app update writes successfully without prompting.

There's no automatic way to move from a per-machine install to a per-user
install - NSIS treats them as different products. Hence the one-time
uninstall-and-reinstall below.

## What you need to do

1. **Uninstall the existing Trace.**
   Settings → Apps → Installed apps → find **Trace** → "Uninstall." Confirm
   the UAC prompt. The uninstaller doesn't touch your data folder.

2. **Reboot.**
   Skipping this isn't fatal, but Windows occasionally holds file locks on
   `trace.exe` / `trace-backend.exe` from the system tray that defeat the
   next install. A reboot clears them in 30 seconds.

3. **Download `Trace_0.5.1_x64-setup.exe`** from the
   [v0.5.1 release page](https://github.com/Effroapp/effro/releases/tag/v0.5.1).

4. **Right-click the downloaded `.exe` → Properties → tick "Unblock" → OK.**
   This clears the Mark of the Web tag that triggers most Smart App Control
   blocks. Skip it and SAC may refuse to launch the installer.

5. **Double-click the `.exe`** (no "Run as administrator" needed - it's a
   per-user install now).
   - Trace lands in `%LOCALAPPDATA%\Programs\Trace\`.
   - The Start Menu shortcut + any pinned shortcuts get refreshed
     automatically.

6. **Launch Trace and verify.**
   - Sidebar footer should read **v0.5.1**.
   - Settings page should show the new **Integrations** hub at the top.
   - Your areas, threads, entries, and uploads should all be exactly where
     you left them.

## What about my data?

Untouched. Trace stores everything under
`%APPDATA%\com.trace.app\` (or wherever you pointed it via Settings →
Storage → Change…). The install folder only holds the executable, the
backend sidecar, and the bundled frontend - all of which the new installer
replaces wholesale.

## After this

Every future release - v0.5.2, v0.6.0, etc. - will install via the cog
icon → "Check for updates" or the auto-detection on launch. No more
Defender exclusions, no more "Run as administrator," no more SAC fights for
versions whose installer signature matches the previous trusted one.

(Once Azure Trusted Signing lands on a future release, SAC won't object on
the first install either.)
