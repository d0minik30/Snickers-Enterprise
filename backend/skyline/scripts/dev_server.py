"""Development server for the skyline API only, so the app can be built before the main server exists.

Serves the skyline router on http://localhost:8000 with CORS open to the local Next.js dev server.
The real server (backend/, Person 1) includes the same router; this file is not used in production.

Run from the repo root:  py -3.10 backend/skyline/scripts/dev_server.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from skyline.api import router  # noqa: E402

app = FastAPI(title='Skyline (dev)')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:3000', 'http://127.0.0.1:3000'],
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)
app.include_router(router)


@app.get('/health')
def health() -> dict:
    return {'ok': True, 'service': 'skyline-dev'}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8000)
