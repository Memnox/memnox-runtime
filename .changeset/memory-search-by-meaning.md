---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Memory search can rank by meaning as well as by keyword, through a local embedding model and only once you turn it on: `memnox config set embeddingModel nomic-embed-text` asks Ollama on this machine, or whatever `embeddingUrl` names, which must be on this machine too. Each item's vector is kept beside it in `memory.db` and made again when its words change, a search embeds at most 64 new items, and the cosine ranking is fused with the keyword results. The `memory-search` answer now says how it searched in `memorySearchMode`, keyword or semantic, and when the model is off or does not answer it is keyword only, with `memorySearchNote` saying why.
