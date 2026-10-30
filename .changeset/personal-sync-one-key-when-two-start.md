---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Two of a person's machines starting personal sync at the same moment now settle on one sync key instead of each waiting for the other or each making its own. The machine whose key Memnox Cloud registered first makes it, by registration time and then machine id, which every machine reads in the same order. A machine that made a key before an earlier one came into view lets it go before anything is sealed under it, refuses to offer it, and waits for the earlier machine's key like any new machine.
