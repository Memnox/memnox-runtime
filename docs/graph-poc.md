# Code graph: proof of concept

Which files depend on the one an agent is about to change, so two agents on
related code can be told before they collide (`VISION.md` section 9). This
measures the two ways to answer it. Nothing in the CLI calls it yet.

## What was built

`packages/core/src/graph/`:

- `code-graph.ts`: the graph shape (`CodeGraph`: files and import edges) and
  `dependentsOf(graph, file, hops)`, which follows imports back up to three
  hops, nearest first.
- `import-scan.ts`: the builtin source. Reads relative `import`, `export from`,
  `import()` and `require()` lines and resolves them the way TypeScript does,
  including a `.js` specifier naming a `.ts` file. Package imports add no edge.
  Pure: the caller hands it the files.
- `graphify-graph.ts`: reads a Graphify `graphify-out/graph.json`, keeping only
  `imports_from` edges marked `EXTRACTED`, so an inferred similarity never
  reads as a dependency.

## Measured

Both run over `memnox-cloud`'s `src/` and `scripts/` (769 files) on a laptop,
3 November 2026. The Graphify graph in that repository was built 475 commits
earlier.

| | Builtin scan | Graphify graph |
|---|---|---|
| Time | 32 ms to read the files, 21 ms to scan | 15 ms to parse the file |
| Import edges | 4,578 | 1,563 |
| Edges both found | 1,383 | 1,383 |
| Found only by this one | 3,195 | 180 |
| Files depending on `src/platform/sql.ts` within 3 hops | 227 | 178 |
| Files importing it directly | 147 | 107 |

Of the edges only Graphify had, the ones checked no longer exist in the code:
`src/approvals/held-calls.ts` does not import `src/platform/sql.ts` any more.
Of the edges only the builtin scan had, the ones checked are real, value
imports included (`src/admin/admin-billing.controller.ts` imports
`src/billing/plans.ts`). The builtin scan also counts `import type`, which a
compiler needs and a running process does not.

## What it means

- **For "who depends on this file", the builtin scan is the answer.** It is
  current every time it runs, finds about three times the edges, costs about
  50 ms on a 770 file repository, and needs nothing installed.
- **A Graphify graph is a snapshot**, as old as its last build, and its import
  extraction misses edges the code states. Its value is the relations a scan
  cannot see (calls, rationale, similarity), which are inferred and so are not
  something a coordination warning should rest on.
- **Next, if this is taken further:** run the scan when a lease is taken
  (`coordination/lease-gate.ts`) and tell the agent which leased files depend
  on the one it is writing. Cache the graph per repository head, since the scan
  is cheap but not free on every write. Keep the Graphify reader only if a
  feature needs its non import relations.
