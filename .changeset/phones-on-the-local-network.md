---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A paired phone can reach this machine on the local network, with no account at all. It is off until the person turns it on with `lan-set`, which is a proposal the Mac signs; turning it off is immediate. The daemon then listens on its private addresses only, announces `_memnox._tcp` over Bonjour under a random name, and the pairing QR names the local address and port beside the relay, or instead of it where nobody is signed in. The Noise sessions and every capability check are the same as over the relay. `lan-status` says whether it is on, where it listens, whether it is announced, and which paired phones reach it now.
