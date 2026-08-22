"""
Shared fixtures for the backend suite.

The app reads DB_PATH and EFFRO_AUTH_ENABLED at module-import time, so a test
cannot simply flip an environment variable on an already-imported app. Each
fixture therefore drops the app's modules from sys.modules, sets the
environment it wants, and imports afresh. That gives a genuinely isolated
FastAPI app on a throwaway SQLite file, with the lifespan running the real
migrations.

Fixtures are module-scoped so two differently-configured apps never sit side by
side within one test module.
"""
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Modules that cache the environment at import time and so must be reloaded.
_RELOAD_PREFIXES = ("routers", "main", "database", "models", "dependencies",
                    "auth_utils", "licence_manager", "connectors", "scheduler")


def _purge_app_modules():
    for name in list(sys.modules):
        if name in _RELOAD_PREFIXES or name.startswith("routers"):
            del sys.modules[name]


def build_client(tmp_path, auth_enabled=False):
    """An isolated TestClient on a fresh database, with auth on or off."""
    from fastapi.testclient import TestClient

    os.environ["DB_PATH"] = str(tmp_path / "test.db")
    if auth_enabled:
        os.environ["EFFRO_AUTH_ENABLED"] = "1"
    else:
        os.environ.pop("EFFRO_AUTH_ENABLED", None)

    _purge_app_modules()
    import main  # noqa: PLC0415 (deliberately late, see the module docstring)
    return TestClient(main.app)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Desktop mode: auth off, so every request is the synthetic local admin."""
    tmp = tmp_path_factory.mktemp("desktop")
    with build_client(tmp, auth_enabled=False) as c:
        yield c


@pytest.fixture(scope="module")
def auth_client(tmp_path_factory):
    """Hosted mode: auth on, so a session cookie is required."""
    tmp = tmp_path_factory.mktemp("hosted")
    with build_client(tmp, auth_enabled=True) as c:
        yield c
