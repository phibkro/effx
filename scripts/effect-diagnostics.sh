#!/usr/bin/env bash
# Effect language-service diagnostics over every project in effect-diagnostic-projects.txt, each of
# which must carry the policy of tsconfig.effect-stability.json (spec 0033): every default-on rule
# is an error. `--strict` also fails on a warning or message.
#
# The example projects include their generated `.effx/` output, so it is built first, as the gate
# did before. Every project is then run even when an earlier one has findings, and the script fails
# at the end.
#
# Each project also gets a canary: a scratch project that extends the project's tsconfig and holds
# scripts/effect-canary.txt, one known finding. The run must report it as an error. A disabled
# language service, a lost severity map or a widened allowlist reports a clean run otherwise, and
# a clean run looks the same as a run that checked nothing.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
failed=0
PATH="$root/node_modules/.bin:$PATH"

bun run --cwd "$root/examples/users" effx:build >/dev/null || exit 1
bun run --cwd "$root/examples/persistence" build >/dev/null || exit 1

scratch="$(mktemp -d "$root/.effect-canary-XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

while IFS= read -r project; do
  echo "== $project"
  effect-tsgo diagnostics --project "$root/$project/tsconfig.json" --strict --format text || failed=1

  dir="$scratch/$(echo "$project" | tr '/.' '__')"
  mkdir -p "$dir"
  cp "$root/scripts/effect-canary.txt" "$dir/canary.ts"
  printf '{"extends":"%s","compilerOptions":{"paths":{}},"include":["canary.ts"],"exclude":[]}\n' \
    "$root/$project/tsconfig.json" >"$dir/tsconfig.json"

  report="$(effect-tsgo diagnostics --project "$dir/tsconfig.json" --format text 2>&1 || true)"
  if ! grep -q "canary.ts(.*): error effect(unstableApiUsage)" <<<"$report"; then
    echo "effect-diagnostics: the canary was not reported as an error for $project; the policy is not in force there" >&2
    echo "$report" >&2
    failed=1
  fi
done <"$root/scripts/effect-diagnostic-projects.txt"

exit "$failed"
