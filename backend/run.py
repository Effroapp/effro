"""
Entry point for the PyInstaller bundle and direct local runs.
Usage: python run.py [--port PORT] [--data-dir PATH]

In the Tauri sidecar context this is what `effro-backend.exe` runs.
For Docker the existing `uvicorn main:app …` CMD is unchanged - this
file is only used by the desktop packaging path.
"""
import os
import sys

# When running as a PyInstaller bundle, make sure both the binary directory
# and the _internal data directory are on sys.path so imports resolve.
if getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.dirname(sys.executable))
    sys.path.insert(0, sys._MEIPASS)  # type: ignore[attr-defined]

import uvicorn
from main import app, _args


if __name__ == "__main__":
    port = _args.port or int(os.environ.get("PORT", "8080"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
    )
