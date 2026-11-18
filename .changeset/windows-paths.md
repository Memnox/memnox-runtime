---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

On Windows, a rule naming a path with `/` now matches the `\` path Windows hands over, so a deny on `.ssh` or a credential file holds there as it does on macOS and Linux, and a task's declared paths no longer ask about every write inside them. Credential files are classed as credentials on Windows, a binary in Downloads or in the project is reported as unusual, a shell write takes its lease, a session's recorded paths and the code fingerprint name repository files with `/`, a repository root git reports as `C:/...` is used as `C:\...`, and `memnox lock` accepts a folder Windows names by its short form. A config backup on Windows is a plain file again rather than a hidden stream of a file named after the drive, and a write Windows briefly refuses because another program has the file open is tried again.
