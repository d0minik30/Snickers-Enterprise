"""The engine's HTTP server: POST /locate and GET /health, plus the skyline step's routes.

Run from backend/:
    .venv\\Scripts\\python -m uvicorn marsloc.api:app --port 8000          (Windows)
    .venv/bin/python -m uvicorn marsloc.api:app --port 8000               (macOS, Linux)

The app (frontend) reaches it at NEXT_PUBLIC_ENGINE_URL, by default http://localhost:8000.
CORS allows http://localhost:3000; add the hosted site with the environment variable
MARS_CORS_ORIGINS (comma-separated origins).

Terrain and precomputed horizons load when the server starts (about 2 seconds). If they are
missing, the server still starts: /health says what is wrong and /locate answers 503.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .constants import CONTRACT_VERSION
from .contracts import LocateRequest

_state = {"engine": None, "error": None}


def get_engine():
    """The loaded Engine, or None (then _state["error"] says why)."""
    if _state["engine"] is None and _state["error"] is None:
        try:
            from .engine import Engine
            _state["engine"] = Engine()
        except Exception as error:      # missing terrain or horizons: report it, don't crash the server
            _state["error"] = "%s" % error
    return _state["engine"]


@asynccontextmanager
async def _lifespan(app):
    get_engine()
    yield


app = FastAPI(title="Mars localization engine", version=CONTRACT_VERSION, lifespan=_lifespan)

_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_origins += [o.strip() for o in os.environ.get("MARS_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])

try:                                    # Person 3's photo -> skyline routes, on the same address
    from skyline.api import router as _skyline_router
    app.include_router(_skyline_router)
    SKYLINE_ROUTES = True
except Exception:                       # its packages are not installed: /locate still works
    SKYLINE_ROUTES = False


@app.get("/health")
def health():
    engine = get_engine()
    return {"status": "ok" if engine is not None else "not_ready",
            "contract_version": CONTRACT_VERSION,
            "terrain_loaded": engine is not None,
            "skylines_loaded": engine is not None,
            "skyline_routes": SKYLINE_ROUTES,
            "detail": _state["error"]}


@app.post("/locate")
def locate(request: LocateRequest):
    """CONTRACTS.md: section 2 in, section 3 out. A body that breaks the contract gets 422."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="the engine is not ready: %s" % _state["error"])
    try:
        return engine.locate(request)
    except ValueError as error:         # e.g. samples that are not numbers
        raise HTTPException(status_code=422, detail=str(error)) from None
