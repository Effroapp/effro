#!/usr/bin/env python3
"""
Build the Effro. backend as a PyInstaller onedir bundle and stage it where
Tauri's sidecar mechanism expects it.

Tauri v2 sidecar naming convention:
    src-tauri/binaries/{name}-{rust-target-triple}/
e.g. on Windows x64:
    src-tauri/binaries/effro-backend-x86_64-pc-windows-msvc/

Run from the repo root:
    python scripts/build-backend.py
"""
import os
import shutil
import subprocess
import sys

# Force UTF-8 stdout on Windows so the box-drawing chars below don't blow up
# under the default cp1252 console code page.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _find_rustc() -> str:
    """Resolve a usable rustc binary.

    Prefers $PATH, then falls back to the standard rustup install location
    (~/.cargo/bin/rustc[.exe]) since cargo's bin dir is often missing from
    the shell that launches this script - particularly Windows `py` launcher
    sessions, which don't source the user's shell profile.
    """
    candidate = shutil.which("rustc")
    if candidate:
        return candidate
    home = os.path.expanduser("~")
    fallback = os.path.join(
        home, ".cargo", "bin",
        "rustc.exe" if sys.platform == "win32" else "rustc",
    )
    if os.path.exists(fallback):
        return fallback
    raise RuntimeError(
        "rustc not found on PATH or at ~/.cargo/bin/. "
        "Install Rust from https://rustup.rs/ and re-open your shell."
    )


def get_rust_triple() -> str:
    """Return the current Rust target triple via `rustc -vV`."""
    rustc = _find_rustc()
    result = subprocess.run(
        [rustc, "-vV"],
        capture_output=True, text=True, check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not determine Rust target triple from `rustc -vV`")


def _check_backend_deps_installed() -> None:
    """Fail loud and early if the backend's runtime deps aren't importable.

    Without this, PyInstaller silently produces a bundle that omits the
    missing modules, then the installed app crashes at startup with
    `ModuleNotFoundError: No module named 'uvicorn'`. We've shipped that
    footgun once already - never again.
    """
    required = ["uvicorn", "fastapi", "sqlalchemy", "anthropic", "apscheduler"]
    missing = []
    for mod in required:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        raise RuntimeError(
            f"Backend dependencies missing from this Python ({sys.executable}): "
            f"{', '.join(missing)}.\n"
            f"Install them first:  py -m pip install -r backend/requirements.txt"
        )


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(repo_root)

    # 0. Sanity-check the Python environment before doing anything expensive.
    _check_backend_deps_installed()

    # 1. Build the React frontend
    print("── Building React frontend...")
    subprocess.run(
        ["npm", "run", "build"],
        cwd=os.path.join(repo_root, "frontend"),
        check=True,
        shell=(sys.platform == "win32"),
    )

    # 2. Run PyInstaller against the spec
    print("── Running PyInstaller...")
    subprocess.run(
        [sys.executable, "-m", "PyInstaller",
         "backend/effro-backend.spec",
         "--noconfirm",
         "--clean"],
        cwd=repo_root,
        check=True,
    )

    # 3. Resolve where Tauri will look for the sidecar
    triple = get_rust_triple()
    dest_dir = os.path.join(repo_root, "src-tauri", "binaries", f"effro-backend-{triple}")
    print(f"── Rust target triple: {triple}")
    print(f"── Copying binary to:  {dest_dir}")

    # 4. Copy the onedir output into src-tauri/binaries/
    src_dir = os.path.join(repo_root, "dist", "effro-backend")
    if not os.path.exists(src_dir):
        raise RuntimeError(
            f"PyInstaller output not found at {src_dir}. "
            "The PyInstaller step may have failed - re-run with --clean."
        )

    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)
    shutil.copytree(src_dir, dest_dir)

    print(f"── Done. Backend binary at {dest_dir}")
    print()
    print("Next: run `tauri build` from the repo root to produce the installer.")


if __name__ == "__main__":
    main()
