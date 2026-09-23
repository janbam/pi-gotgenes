#!/usr/bin/env bash
# Shared helpers for the git-cliff release scripts. Source this file; do not run it.
#
# Every package in this monorepo is versioned and changelogged independently, so
# each git-cliff invocation is scoped to one package by a tag pattern and a set
# of path filters. Those filters live here rather than in `cliff.toml` because
# git-cliff accepts `--include-path`/`--exclude-path` as command-line arguments
# only (Refs #865).

# Internal working docs are excluded from every package's release scope: a plan,
# a retro, or an architecture note is not a released change.
#
# Under release-please this was a hand-maintained `exclude-paths` array in
# `release-please-config.json` that had to be edited whenever a package gained a
# new docs subdirectory. Here it is a convention, verified at migration time to
# reproduce that array exactly across all nine packages — including that
# `pi-permission-system/docs/guides` and `docs/migration` stay *included*,
# because they are shipped user documentation.
#
# A package's own CHANGELOG.md is excluded too, so a changelog-writing commit
# never re-enters the next changelog.
#
# An array, not a space-separated string: bash word-splits an unquoted parameter
# and zsh does not, so a string collapses into the single bogus glob
# `docs/plans retro architecture decisions assets/**` when this file is sourced
# from an interactive zsh. That excludes nothing, and the only symptom is a
# changelog quietly containing commits it should not.
CLIFF_EXCLUDED_DOC_DIRS=(plans retro architecture decisions assets)

# Print each package directory name, one per line.
#
# The workspace on disk is the source of truth. This replaces the derivation
# from `.release-please-manifest.json`, which no longer exists.
release_packages() {
  local dir
  for dir in packages/*/; do
    [ -f "${dir}package.json" ] || continue
    basename "$dir"
  done
}

# Fail unless $1 names a real package.
require_package() {
  local pkg=${1:-}
  if [ -z "$pkg" ] || [ ! -f "packages/$pkg/package.json" ]; then
    echo "Error: unknown package '${pkg}' (no packages/${pkg}/package.json)" >&2
    return 1
  fi
}

# Populate the global array CLIFF_ARGS with the scoping flags for package $1.
#
# A global array rather than stdout: the values contain glob characters and must
# not be re-split or expanded by the caller's shell.
cliff_args() {
  local pkg=$1 sub
  CLIFF_ARGS=(
    --tag-pattern "^${pkg}-v"
    --include-path "packages/${pkg}/**"
    --exclude-path "packages/${pkg}/CHANGELOG.md"
  )
  for sub in "${CLIFF_EXCLUDED_DOC_DIRS[@]}"; do
    CLIFF_ARGS+=(--exclude-path "packages/${pkg}/docs/${sub}/**")
  done
}

# Print the newest release tag for package $1, or nothing if it has never
# released. `-v:refname` compares the embedded version numerically, so
# `pi-subagents-v21.2.0` sorts above `pi-subagents-v9.0.0`; a lexical sort would
# not.
#
# The count is applied inside git, with no pipe. The obvious spelling —
# `git tag --list ... | head -1` — is a SIGPIPE race under `set -euo pipefail`:
# `head` exits as soon as it has its line, and once a package's tag listing
# exceeds one stdio buffer (4096 bytes) git needs a second flush, which then
# lands on a closed pipe. git dies with SIGPIPE, `pipefail` promotes the 141,
# and `set -e` aborts the caller — for `next-version.sh` that is an empty
# version, and for `prepare-release.sh` a release that fails ~10ms in with no
# diagnostic beyond `exit code 141`.
#
# It is a race, not a threshold, so it fails intermittently and then settles
# into failing always: `pi-permission-system` crossed 4096 bytes at ~141 tags,
# released four more times, and then could not release at all. Every other
# package is still single-flush, which is why it presented as one package being
# unreleasable.
#
# Keep this pipe-free. The `--count=1` is what makes it safe, not an
# optimization.
latest_tag() {
  git for-each-ref --count=1 --sort=-v:refname \
    --format='%(refname:strip=2)' "refs/tags/$1-v*"
}

# Print the version recorded in package $1's package.json.
package_json_version() {
  jq -r '.version' "packages/$1/package.json"
}
