#!/usr/bin/env bash
set -euo pipefail
claude plugin marketplace add anthropics/claude-plugins-official || true
claude plugin marketplace add boosterchile/booster-skills || true
claude plugin install superpowers@claude-plugins-official --scope project
claude plugin install booster-skills@booster-skills --scope project
claude plugin list
