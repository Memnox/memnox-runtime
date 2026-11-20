# @memnox/noise

## 0.1.2

### Patch Changes

- d8793cb: `memnox update` now requires provenance from `github.com/Memnox/memnox-runtime`, the repository's name since it was renamed from `Memnox/memnox`, and every package names that repository, so a release published through trusted publishing verifies again. The Noise addons are published again with it, since `memnox update` holds every `@memnox/*` package it installs to provenance and the 0.1.1 ones carry none. A copy installed before this release still trusts the old name and refuses this one, so it updates once with `memnox update --skip-verify`, which says so on screen and writes `verified: false` to `~/.memnox/updates.jsonl`, and verifies every release after it.

## 0.1.1

### Patch Changes

- 346e918: The Noise addon is built for Windows on x64, so a daemon running natively on Windows pairs with a phone through the relay as macOS and Linux do.
