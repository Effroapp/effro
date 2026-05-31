// Prevents the extra console window on Windows in release builds.
// In debug mode we keep the console so we can see port selection + health
// check logs while iterating with `cargo tauri dev`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tauri_plugin_store::StoreExt;

/// Stable channel - `latest` redirects to the most recent non-prerelease.
const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/lukeogh/Trace/releases/latest/download/latest.json";

/// Beta channel - CI updates a sliding `beta` release tag on every push to
/// `main`, so this URL always points at the most recent beta build.
const BETA_UPDATE_ENDPOINT: &str =
    "https://github.com/lukeogh/Trace/releases/download/beta/latest-beta.json";

/// Config-store key for the user's chosen update channel ("stable" | "beta").
/// Defaults to "stable" if unset.
const UPDATE_CHANNEL_KEY: &str = "update_channel";

/// GitHub Personal Access Token baked in at build time (via build.rs). Read-
/// only, scoped to the single private `lukeogh/Trace` repo. Used by the
/// frontend as a Bearer header on updater requests so we can fetch the
/// manifest + bundle from the private releases endpoint.
///
/// `None` in local dev builds without the env var set - the updater simply
/// won't function, which is acceptable in dev (you ship updates from CI).
const UPDATER_TOKEN: Option<&str> = option_env!("TRACE_UPDATER_TOKEN");

/// PyInstaller onedir folder name for our backend bundle. Must match what
/// `scripts/build-backend.py` stages under `src-tauri/binaries/` and what
/// `tauri.conf.json` declares as a bundled resource.
const BACKEND_DIR_NAME: &str = "trace-backend-x86_64-pc-windows-msvc";

/// Filename of the persisted config inside the Tauri app-data dir (NOT the
/// user-configurable data dir - Tauri's plugin-store always writes here).
const CONFIG_STORE: &str = "config.json";

/// JSON key inside `CONFIG_STORE` holding the user-chosen data directory.
const DATA_DIR_KEY: &str = "data_dir";

/// Find a free TCP port for the sidecar. Prefers a stable, well-known port
/// (8000) so the Microsoft 365 OAuth redirect URI registered in Azure stays
/// consistent across launches - Microsoft does an exact-match validation on
/// the redirect URI, so a random port breaks the flow when nothing answers
/// on the registered port.
///
/// Falls back to 8001..=8010 if 8000 is taken (another app on the user's
/// machine), then to a random free port as a last resort. If we end up on
/// anything other than 8000, the Microsoft sign-in will only work if the
/// user has registered that exact port in their Azure app config.
///
/// There is a tiny TOCTOU race between the test bind here and the sidecar's
/// real bind - acceptable for a single-user desktop app on the loopback
/// interface, where the gap is microseconds and the contender pool is tiny.
fn find_free_port() -> u16 {
    // Try the preferred port + a small range of fallbacks. The 8000-8010 range
    // is a common "personal local server" band that's usually free; falling out
    // of it is rare.
    for port in 8000u16..=8010 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    // Last resort: any free port. Microsoft sign-in won't work without
    // updating the Azure redirect URI to match.
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind to a free port");
    let port = listener
        .local_addr()
        .expect("failed to read assigned port")
        .port();
    eprintln!(
        "Trace. backend fell back to dynamic port {} (8000-8010 all taken). \
         Microsoft 365 sign-in will need the Azure redirect URI updated to match.",
        port
    );
    port
}

/// Block (with sleeps) until the backend responds to the health endpoint, or
/// until we give up. This runs inside `setup()`, which is synchronous; using
/// reqwest::blocking here avoids deadlocking the Tauri runtime.
fn wait_for_backend(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let max_attempts = 60;          // 60 × 500 ms = 30 s ceiling
    let delay = Duration::from_millis(500);
    for attempt in 0..max_attempts {
        if let Ok(resp) = client.get(&url).send() {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        if attempt == 0 {
            println!("Waiting for Trace. backend on port {}...", port);
        }
        std::thread::sleep(delay);
    }
    Err(format!(
        "Trace. backend did not respond on port {} within 30 seconds",
        port
    ))
}

/// OS-appropriate default per-user data dir. On Windows this is
/// `%APPDATA%\com.trace.app\` (driven by the identifier in tauri.conf.json).
/// Falls back to a `Trace` folder in the platform's local-data dir if Tauri's
/// path resolver fails - which it shouldn't, but defensive code is cheap.
fn default_data_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| {
            dirs::data_local_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Trace")
        })
}

/// Reads the user-chosen data dir from the config store, falling back to the
/// OS default when nothing is saved (first launch, or after a fresh install).
/// Validates that the saved path is at least theoretically usable - i.e. the
/// path itself exists or its parent does - so a stale config from a removed
/// USB drive doesn't trap the user.
fn resolve_data_dir(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(store) = app.store(CONFIG_STORE) {
        if let Some(val) = store.get(DATA_DIR_KEY) {
            if let Some(path_str) = val.as_str() {
                let path = std::path::PathBuf::from(path_str);
                if path.exists() || path.parent().map(|p| p.exists()).unwrap_or(false) {
                    return path;
                }
            }
        }
    }
    default_data_dir(app)
}

// ── Tauri commands invoked from the frontend ─────────────────────────────────

/// Returns the currently resolved data dir as a string.
#[tauri::command]
fn get_data_dir(app: AppHandle) -> String {
    resolve_data_dir(&app).to_string_lossy().to_string()
}

/// Opens a native folder picker. Returns `None` if the user cancelled.
#[tauri::command]
async fn pick_data_dir(app: AppHandle) -> Result<Option<String>, String> {
    // blocking_pick_folder() runs to completion on the calling thread; that's
    // fine here because Tauri commands marked `async` are already dispatched
    // off the main thread by the runtime.
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

/// Copies the user's data (trace.db + uploads/) from the current location to
/// `new_path`, verifies the copy, and writes the new path to the config store.
/// The old location is **never** deleted - copy-not-move is intentional.
///
/// The running sidecar still points at the old data, so the caller is
/// expected to invoke `relaunch` after this succeeds.
#[tauri::command]
async fn migrate_and_set_data_dir(app: AppHandle, new_path: String) -> Result<(), String> {
    let new_dir = std::path::PathBuf::from(&new_path);
    let old_dir = resolve_data_dir(&app);

    if old_dir == new_dir {
        return Ok(()); // no-op
    }

    // Make sure the target exists before we try to write into it.
    std::fs::create_dir_all(&new_dir)
        .map_err(|e| format!("Could not create directory {}: {}", new_path, e))?;

    // Copy the SQLite DB. Skip if the destination already has one - we'd
    // rather refuse than silently clobber data the user might still want.
    let old_db = old_dir.join("trace.db");
    let new_db = new_dir.join("trace.db");
    if old_db.exists() && !new_db.exists() {
        std::fs::copy(&old_db, &new_db)
            .map_err(|e| format!("Failed to copy database: {}", e))?;

        // Sanity-check the copy survived intact. SQLite files start with the
        // 16-byte magic string "SQLite format 3\0".
        let header = std::fs::read(&new_db)
            .map_err(|e| format!("Failed to verify copied database: {}", e))?;
        if header.len() < 16 || &header[..6] != b"SQLite" {
            std::fs::remove_file(&new_db).ok();
            return Err("Copied database file appears corrupt. Migration aborted.".to_string());
        }
    }

    // Copy attachments / avatars / anything else under uploads/.
    let old_uploads = old_dir.join("uploads");
    let new_uploads = new_dir.join("uploads");
    if old_uploads.exists() && !new_uploads.exists() {
        copy_dir_recursive(&old_uploads, &new_uploads)
            .map_err(|e| format!("Failed to copy uploads: {}", e))?;
    }

    // Persist the new path so the next launch picks it up.
    let store = app
        .store(CONFIG_STORE)
        .map_err(|e| format!("Failed to open config store: {}", e))?;
    store.set(DATA_DIR_KEY, serde_json::Value::String(new_path));
    store
        .save()
        .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}

/// Restarts the Tauri app. The new process reads the just-saved data dir
/// from the config store via `resolve_data_dir` and passes it to the sidecar.
#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

/// Returns the chosen update channel - "stable" by default.
#[tauri::command]
fn get_update_channel(app: AppHandle) -> String {
    resolve_update_channel(&app)
}

/// Persists the chosen update channel. Takes effect on next launch (the
/// updater plugin's endpoint is wired at plugin-init time; we don't try to
/// hot-swap because the user has to relaunch for the channel change to be
/// meaningful anyway).
#[tauri::command]
fn set_update_channel(app: AppHandle, channel: String) -> Result<(), String> {
    if channel != "stable" && channel != "beta" {
        return Err(format!("Unknown update channel: {}", channel));
    }
    let store = app
        .store(CONFIG_STORE)
        .map_err(|e| format!("Failed to open config store: {}", e))?;
    store.set(UPDATE_CHANNEL_KEY, serde_json::Value::String(channel));
    store
        .save()
        .map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(())
}

/// Reads the update channel from the config store; defaults to "stable".
fn resolve_update_channel(app: &AppHandle) -> String {
    if let Ok(store) = app.store(CONFIG_STORE) {
        if let Some(val) = store.get(UPDATE_CHANNEL_KEY) {
            if let Some(s) = val.as_str() {
                if s == "stable" || s == "beta" {
                    return s.to_string();
                }
            }
        }
    }
    "stable".to_string()
}

/// Returns the update endpoint URL for the given channel.
fn endpoint_for_channel(channel: &str) -> &'static str {
    match channel {
        "beta" => BETA_UPDATE_ENDPOINT,
        _ => STABLE_UPDATE_ENDPOINT,
    }
}

/// Returns the endpoint that the updater is currently configured to hit.
/// Used by the frontend to display the channel and (optionally) link to the
/// release page.
#[tauri::command]
fn get_update_endpoint(app: AppHandle) -> String {
    endpoint_for_channel(&resolve_update_channel(&app)).to_string()
}

/// Returns the Authorization header value the updater should send on
/// requests to GitHub Releases. `None` means the binary wasn't built with
/// a token baked in (local dev) - in that case the frontend skips the
/// header and the updater fails gracefully when hitting the private repo.
#[tauri::command]
fn get_updater_auth_header() -> Option<String> {
    UPDATER_TOKEN.map(|t| format!("Bearer {}", t))
}


/// Authoritative app version. Returns `env!("CARGO_PKG_VERSION")`, which is
/// the Rust crate version compiled into this binary - sourced from Cargo.toml
/// at build time, bumped in lockstep with tauri.conf.json on every release.
///
/// Why a custom command instead of `@tauri-apps/api/app`'s `getVersion()`:
/// the JS API has historically had permission and WebView-cache edge cases
/// that left the sidebar showing a stale version after an in-place upgrade.
/// Reading from the binary side-steps both classes of issue.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}


/// Recursively copy `src` into `dst`. Existing files at the destination are
/// left alone (this is what makes the migration idempotent - re-running the
/// "Change…" flow with the same destination is a no-op).
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if !dest_path.exists() {
            std::fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}

// ── App setup ────────────────────────────────────────────────────────────────

/// Kills the sidecar - both via Tauri's CommandChild and a follow-up
/// `taskkill /T /F /PID …` to handle the entire process tree on Windows.
/// `child.kill()` alone has proven unreliable: we've seen `trace-backend.exe`
/// survive after `app.exit(0)`, which is the orphan-quit bug from task #67.
///
/// Safe to call multiple times - both `kill()` and `taskkill` return
/// non-zero / errors on a process that's already gone, which we ignore.
fn nuke_sidecar(child: Option<CommandChild>) {
    let Some(child) = child else { return };
    let pid = child.pid();
    let _ = child.kill();

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // POSIX: SIGKILL the process group so children die too.
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .output();
    }
}

/// Belt-and-braces cleanup that runs on every launch BEFORE spawning the
/// sidecar - kills any leftover `trace-backend.exe` from a previous launch
/// that crashed, was force-quit via Task Manager, or otherwise escaped the
/// normal nuke_sidecar() teardown. Safe because we're a single-user
/// desktop app: there's only ever one `trace-backend.exe` that should be
/// running, and if there IS one now, it's an orphan we don't want to
/// leave holding file locks (which prevents installer / updater file
/// replacement and is task #67's recurring symptom).
fn kill_orphan_backends() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "trace-backend.exe"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "trace-backend"])
            .output();
    }
}

fn main() {
    // Shared handle to the spawned sidecar - used so both the window-close
    // handler and the RunEvent::Exit hook can kill the child cleanly on
    // app quit. Two paths to cleanup because in practice neither alone is
    // reliable - see nuke_sidecar() docs.
    let sidecar_child: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let sidecar_child_for_exit = sidecar_child.clone();
    let sidecar_child_for_close = sidecar_child.clone();

    // The updater plugin's default endpoint (in tauri.conf.json) is the
    // stable URL. The frontend reads the chosen channel via
    // `get_update_endpoint` and passes the resolved URL to
    // `check({ endpoints: [url] })` on each check, so the plugin only ever
    // sees the right URL for the current channel.
    //
    // (The tauri-plugin-updater 2.x Rust Builder doesn't expose an
    // `.endpoints()` override; runtime channel switching has to happen on
    // the JS side.)
    let updater = tauri_plugin_updater::Builder::new().build();

    tauri::Builder::default()
        // Plugins must be registered before .setup() runs so resolve_data_dir
        // and resolve_update_channel can read from the store during sidecar
        // spawn.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch happened - focus the existing window instead of
            // starting another backend.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            pick_data_dir,
            migrate_and_set_data_dir,
            relaunch,
            get_update_channel,
            set_update_channel,
            get_update_endpoint,
            get_updater_auth_header,
            app_version,
        ])
        .setup(move |app| {
            // Clean up any orphan backend from a previous launch (crash,
            // Task Manager force-close, antivirus-killed process, etc.)
            // BEFORE we try to spawn a new one - saves the user from
            // having to manually taskkill leftovers.
            kill_orphan_backends();

            let port = find_free_port();
            let data_dir = resolve_data_dir(&app.handle());

            println!("Trace. starting on port {}", port);
            println!("Data directory: {}", data_dir.display());

            std::fs::create_dir_all(&data_dir)?;

            let data_dir_arg = data_dir
                .to_str()
                .ok_or_else(|| "data dir path is not valid UTF-8".to_string())?;

            // Resolve the bundled PyInstaller onedir from the Tauri resource
            // directory. We can't use sidecar() here because PyInstaller
            // produces an .exe + _internal/ folder pair, not a single file -
            // so we ship the whole folder as a resource and invoke the exe
            // by absolute path.
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| format!("failed to resolve resource_dir: {}", e))?;
            let backend_exe = resource_dir
                .join("binaries")
                .join(BACKEND_DIR_NAME)
                .join("trace-backend.exe");

            if !backend_exe.exists() {
                let msg = format!(
                    "trace-backend.exe not found at {} - did `python scripts/build-backend.py` \
                     run before `tauri build`?",
                    backend_exe.display()
                );
                eprintln!("{}", msg);
                return Err(msg.into());
            }

            let child = app
                .shell()
                .command(backend_exe.to_str().ok_or("backend exe path is not UTF-8")?)
                .args([
                    "--port",
                    &port.to_string(),
                    "--data-dir",
                    data_dir_arg,
                ])
                // Expose the chosen port to the sidecar via BACKEND_PORT so the
                // Microsoft 365 OAuth redirect URI matches what the user
                // registered in their Azure app. Without this, microsoft_graph.py
                // defaults to 8000 and the post-consent callback hits a dead
                // port - the source of the "404 after Sign in" bug in v0.6.0-0.6.1.
                .env("BACKEND_PORT", port.to_string())
                .spawn()
                .map_err(|e| {
                    eprintln!("Failed to spawn trace-backend: {}", e);
                    e
                })?;

            *sidecar_child.lock().unwrap() = Some(child.1);
            // Note: shell.command(...).spawn() returns a (rx, child) tuple.
            // The rx half (stdout/stderr) is dropped silently here because the
            // sidecar console is suppressed in release builds.

            // Block this thread until the backend responds. The Tauri runtime
            // hasn't started the event loop yet - this is fine.
            wait_for_backend(port).map_err(|e| {
                eprintln!("{}", e);
                std::io::Error::new(std::io::ErrorKind::TimedOut, e)
            })?;

            // Navigate the (hidden, blank) main window to the live backend,
            // then show it. Doing this after the health check is the reason
            // users never see a blank "connection refused" page.
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            let backend_url = format!("http://127.0.0.1:{}", port);
            window.navigate(backend_url.parse().expect("bad backend URL"))?;
            window.show()?;

            Ok(())
        })
        .on_window_event(move |window, event| {
            // Closing the window = full quit. Kill the sidecar synchronously
            // here BEFORE we let Tauri tear down, so the user doesn't get
            // a lingering `trace-backend.exe` in the background after they
            // hit X. The RunEvent::Exit hook below also runs nuke_sidecar()
            // as a fallback in case the close path takes a different route
            // (tauri shutdown, OS signal, etc.) - see task #67 docs.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let child = sidecar_child_for_close.lock().unwrap().take();
                nuke_sidecar(child);
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Trace. desktop shell")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                // Belt-and-braces cleanup - see nuke_sidecar() docs.
                let child = sidecar_child_for_exit.lock().unwrap().take();
                nuke_sidecar(child);
            }
        });
}

