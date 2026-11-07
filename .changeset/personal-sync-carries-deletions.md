---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A personal skill deleted on one of a person's machines is now taken out of the Skills Hub, every agent's folder and the kept versions on their other machines at their next sync, and `skill-remove` is the Skills Hub method that deletes one here, at once, since taking a skill away only narrows. A deletion that has to wait on a signature on the receiving machine is kept there as a tombstone, so the copy still standing is never sent back to undo it. A skill that arrives from another machine now shows in the Skills Hub, held until it is accepted there.
