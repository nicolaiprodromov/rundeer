#!/usr/bin/env python3
import os
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
_parent = _here.parent
_parent_str = str(_parent)
sys.path = [_parent_str] + [path for path in sys.path if path != _parent_str]

from rundeer.cli.commands import main

if __name__ == "__main__":
    sys.exit(main())
