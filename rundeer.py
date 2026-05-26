#!/usr/bin/env python3
# ▄▄▄▄  ▄▄ ▄▄ ▄▄  ▄▄ ▄▄▄▄  ▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄  
# ██▄█▄ ██ ██ ███▄██ ██▀██ ██▄▄  ██▄▄  ██▄█▄ 
# ██ ██ ▀███▀ ██ ▀██ ████▀ ██▄▄▄ ██▄▄▄ ██ ██ 

import os
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
_src_pkg = _here / "src" / "rundeer"
__path__ = [str(_here)]
if _src_pkg.is_dir():
    __path__.append(str(_src_pkg))
__version__ = "0.3.5"
_parent_str = str(_here.parent)
sys.path = [_parent_str] + [path for path in sys.path if path != _parent_str]

from rundeer.cli.commands import main

if __name__ == "__main__":
    sys.exit(main())
