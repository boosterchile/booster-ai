#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ ! -L .git/sdd ]; then
  rm -rf .git/sdd
  ln -s ../docs/sdd .git/sdd
fi
