#!/usr/bin/env bash
# Effect language-service diagnostics over every project that carries the policy in
# tsconfig.effect-stability.json (spec 0033). Every default-on rule is an error there, and
# --strict also fails on a warning or message. The example projects include their generated
# `.effx/` output, which `bun run gate` builds first.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

for project in . tools examples/users examples/persistence examples/domain-model examples/extension-openapi-tags; do
  effect-tsgo diagnostics --project "$root/$project/tsconfig.json" --strict --format text
done
