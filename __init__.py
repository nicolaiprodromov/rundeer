from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent
_SRC_PKG_DIR = _PKG_DIR / "src" / "rundeer"
if _SRC_PKG_DIR.is_dir():
	__path__.append(str(_SRC_PKG_DIR))

__version__ = "0.2.0"
