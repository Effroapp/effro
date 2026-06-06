fn main() {
    // Bake the updater PAT into the binary at compile time so we can hit
    // the private GitHub releases endpoint without the user supplying a
    // token. The value comes from the EFFRO_UPDATER_TOKEN env var, set by
    // CI via the repo secret of the same name. Local dev builds without
    // the env var simply lack the token (the updater fails open - it just
    // can't reach the private endpoint, which is fine in dev).
    //
    // Rerun this build script if the env var changes, otherwise cargo
    // would reuse the old bake-in.
    println!("cargo:rerun-if-env-changed=EFFRO_UPDATER_TOKEN");
    if let Ok(token) = std::env::var("EFFRO_UPDATER_TOKEN") {
        println!("cargo:rustc-env=EFFRO_UPDATER_TOKEN={}", token);
    }

    tauri_build::build()
}
