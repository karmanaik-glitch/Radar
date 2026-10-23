#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "STRATA preview: http://localhost:8000/app/"
python3 -m http.server 8000
