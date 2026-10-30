---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The session tools `memory` and `brief` now read what this machine learned first and the workspace pull after it, handing confirmed facts as facts and everything waiting in Learn apart as unconfirmed. A new session tool, `memnox_suggest`, lets an agent propose a fact, a convention or a rule into the same Learn queue, where it waits for the person and is never promoted by itself.
