---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

`memnox uninstall` also takes our hook out of Claude Code's personal settings at home and in the repository and out of its managed settings where it can write them, and a workspace server left in an agent's config after its onboarding record was lost. With `--purge` it removes the memnox package itself: an `npm link` loses only the link and its bins, a global install loses its own folder, and the copy the Mac app keeps goes with `~/.memnox`.
