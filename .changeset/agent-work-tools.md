---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

An agent reads and reports on the work its person pointed it at through `memnox-session`: `my_work`, `report_progress`, `mark_blocked` and `request_handoff`. None of them starts, assigns, stops or closes work, and an agent can claim done but never close. The voice gains `start_agent_work`, which waits for a yes read back, `show_agent_work` and `answer_handoff`, each acting only for the person it speaks for.
