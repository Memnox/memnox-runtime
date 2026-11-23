---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

The config watcher no longer watches your home folder or `~/.config` whole, which on Linux ran out of file watchers and stopped the daemon within minutes; it now wakes only for the agent configs named in them.
