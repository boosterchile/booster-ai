#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
common_dir="$(git rev-parse --git-common-dir)"
if [ ! -L "$common_dir/sdd" ]; then
  rm -rf "$common_dir/sdd"
  ln -s ../docs/sdd "$common_dir/sdd"
fi
