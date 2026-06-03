fn main() {
    // No updater token is baked in: the Effroapp/effro releases repo is
    // public, so the updater downloads manifests and bundles anonymously.
    // (Previously a PAT was injected here for the old private repo; that
    // stale token caused GitHub to answer 401 and broke auto-update.)
    tauri_build::build()
}
