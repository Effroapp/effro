fn main() {
    // No updater token is baked in: the Effroapp/effro releases repo is
    // public, so the updater downloads manifests and bundles anonymously.
    // (Previously a PAT was injected here for the old private repo; that
    // stale token caused GitHub to answer 401 and broke auto-update.)
    //
    // App command permissions are declared EXPLICITLY here instead of relying
    // on tauri-build's auto-discovery. Auto-discovery is two-pass (the command
    // macros emit permission files that the NEXT build reads) and did not pick
    // up a newly added command under `cargo check`, which failed capability
    // validation for `allow-check-update`. Listing the commands makes the
    // generated `allow-<cmd>` / `deny-<cmd>` permissions deterministic.
    // KEEP THIS LIST IN SYNC with the `generate_handler!` call in main.rs.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_data_dir",
                "pick_data_dir",
                "migrate_and_set_data_dir",
                "relaunch",
                "get_update_channel",
                "set_update_channel",
                "get_update_endpoint",
                "get_updater_auth_header",
                "check_update",
                "app_version",
                "take_just_updated",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
