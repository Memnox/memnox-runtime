---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A budget can carry a warning line. `memnox budget set <name> --warn-at <n>` tells the person once, through the waiting feed, when a budget passes that line and again when it runs out, so a stop is never the first they hear of it. The warning never holds anything, and `memnox budget` prints the line beside the spend.
