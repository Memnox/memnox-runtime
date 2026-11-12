---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A held call's card on the terminal now closes the moment the call is answered from the phone, the console or `memnox approve`, and says who answered. It used to keep counting down and leave "nobody answered, so refused" in the scrollback for a call that had been allowed.
