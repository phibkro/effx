#!/usr/bin/env bash
# Anonymous public-registry install. This is the one custody boundary for every effx resolver run.
# It needs no installed dependency, so it can bootstrap the workspace itself.
#
# usage: install-public.sh <directory> [--frozen-lockfile] [--ignore-scripts]
#
# The child environment is REPLACED (env -i): only PATH plus a private 0700 HOME, an empty user
# config, a closed bunfig and a private cache reach the resolver. No dotenv file is read, stdin is
# closed, and the project must not carry its own .npmrc/bunfig.toml. Resolver output is never
# captured or logged by this script; only the exit code is reported.
set -euo pipefail

directory="${1:?usage: install-public.sh <directory> [--frozen-lockfile] [--ignore-scripts]}"
shift

flags=()
for flag in "$@"; do
  case "$flag" in
    --frozen-lockfile | --ignore-scripts) flags+=("$flag") ;;
    *)
      echo "install-public: unsupported flag" >&2
      exit 2
      ;;
  esac
done

test -d "$directory"
if [ -e "$directory/.npmrc" ] || [ -e "$directory/bunfig.toml" ]; then
  echo "install-public: project-owned resolver configuration is not allowed" >&2
  exit 2
fi

home="$(mktemp -d)"
chmod 700 "$home"
trap 'rm -rf "$home"' EXIT
: >"$home/.npmrc"
chmod 600 "$home/.npmrc"
printf '[install]\nregistry = "https://registry.npmjs.org"\n' >"$home/bunfig.toml"
mkdir -m 700 "$home/cache"

if env -i PATH="$directory/node_modules/.bin:$PATH" HOME="$home" NPM_CONFIG_USERCONFIG="$home/.npmrc" \
  BUN_INSTALL_CACHE_DIR="$home/cache" \
  bun --no-env-file install --cwd="$directory" --backend=copyfile ${flags[@]+"${flags[@]}"} \
  --registry=https://registry.npmjs.org --config="$home/bunfig.toml" --cache-dir="$home/cache" \
  </dev/null >/dev/null 2>&1; then
  echo "install-public: complete"
else
  code=$?
  echo "install-public: resolver exited $code" >&2
  exit "$code"
fi
