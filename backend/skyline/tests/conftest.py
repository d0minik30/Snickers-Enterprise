import sys
from pathlib import Path

# Make `skyline` importable as a package whether pytest runs from the repo root or from backend/.
BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))
