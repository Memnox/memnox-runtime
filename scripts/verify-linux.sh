#!/bin/sh
# Runs CI's Ubuntu job here, in a container, so a failure only Linux shows is found before a push.
# The checkout is copied in read only, so nothing the run builds or writes lands in it.
#
#   pnpm verify:linux                  Node 24
#   NODE_VERSION=22 pnpm verify:linux  Node 22
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
node_version="${NODE_VERSION:-24}"
image="memnox-verify-linux:node$node_version"

docker build --quiet --tag "$image" --build-arg NODE_VERSION="$node_version" \
  --file "$here/scripts/verify-linux.Dockerfile" "$here/scripts" >/dev/null

docker run --rm --volume "$here:/src:ro" "$image" sh -c '
  set -eu
  mkdir work
  # Everything but what this machine built, which is built again for Linux inside.
  tar -C /src --exclude="./node_modules" --exclude="*/node_modules" --exclude="*/dist" \
    --exclude="./native/noise/target" -cf - . | tar -C work -xf -
  cd work
  pnpm install --frozen-lockfile
  pnpm --filter @memnox/noise build
  pnpm run format:check
  pnpm run typecheck
  pnpm run build
  pnpm run test
  pnpm run deadcode
'
