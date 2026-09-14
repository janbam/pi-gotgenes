#!/usr/bin/env bash

set -euo pipefail

readonly PI_FORK_URL="https://github.com/janbam/pi-mono.git"
readonly PI_FORK_SHA="a97997d596603579386742a4723daaaee4a89513"
readonly PI_MODEL_DATA_URL="https://github.com/earendil-works/pi/releases/download/v0.85.1/pi-0.85.1-source.tar.gz"
readonly PI_MODEL_DATA_SHA256="f7ec92ed4f7b75369198398a3421732eae405183971450bc74cb8544f42d02ca"

# Local development owns ~/src/pi-mono; this script exists only to reproduce
# that fork dependency in an ephemeral GitHub runner.
if [[ "${CI:-}" != "true" || -z "${RUNNER_WORKSPACE:-}" ]]; then
	echo "prepare-pi-fork.sh may run only in GitHub CI" >&2
	exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
pi_root="$(realpath -m "$repo_root/packages/pi-subagents/../../../../pi-mono")"
expected_root="$(dirname "$RUNNER_WORKSPACE")/pi-mono"
readonly repo_root pi_root expected_root
model_data_archive="$pi_root/pi-model-data.tar.gz"
readonly model_data_archive

# Keep the checkout coupled to the package.json link target; a path drift must
# fail here instead of producing dangling dependencies later in TypeScript.
if [[ "$pi_root" != "$expected_root" ]]; then
	echo "Pi fork link resolves to unexpected path: $pi_root" >&2
	exit 1
fi
if [[ -e "$pi_root" ]]; then
	echo "Pi fork checkout path already exists: $pi_root" >&2
	exit 1
fi

# Fetch one reviewed fork revision, then build its ignored distribution files
# before pnpm resolves this repository's local links.
mkdir "$pi_root"
git -C "$pi_root" init --quiet
git -C "$pi_root" remote add origin "$PI_FORK_URL"
git -C "$pi_root" fetch --quiet --depth=1 origin "$PI_FORK_SHA"
git -C "$pi_root" checkout --quiet --detach FETCH_HEAD

# Pi keeps generated provider data out of Git. Seed the release's verified
# snapshot instead of making CI depend on mutable model and pricing websites.
curl --fail --location --silent --show-error "$PI_MODEL_DATA_URL" --output "$model_data_archive"
echo "$PI_MODEL_DATA_SHA256  $model_data_archive" | sha256sum --check -
tar -xzf "$model_data_archive" -C "$pi_root" --strip-components=1 \
	"pi-0.85.1/packages/ai/src/providers/data"
rm "$model_data_archive"

(
	cd "$pi_root"
	npm ci --ignore-scripts
	npm run build:offline
)
