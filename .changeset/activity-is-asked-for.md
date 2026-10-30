---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The live `activity` event is sent only to a subscriber that asks for it with `subscribeActivity: true` on `subscribe`, and a paired phone still also needs the see capability. An app built before the event treats a kind it does not know as something to say, so a plain subscriber never hears it.
