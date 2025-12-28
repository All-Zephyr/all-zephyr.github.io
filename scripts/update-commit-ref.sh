#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

ref="$(git rev-parse --short HEAD)"
export COMMIT_REF="$ref"

python3 - <<'PY'
import os
import pathlib
import re

path = pathlib.Path("app.js")
text = path.read_text()
ref = os.environ["COMMIT_REF"]
pattern = r'const COMMIT_REF = "[^"]*";'
replacement = f'const COMMIT_REF = "{ref}";'
new_text, count = re.subn(pattern, replacement, text, count=1)
if count != 1:
    raise SystemExit("COMMIT_REF constant not found in app.js")
path.write_text(new_text)
PY

git add app.js
git commit -m "Update commit ref"
git push

echo "Updated COMMIT_REF to $ref"
