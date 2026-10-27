# Load testing the control plane

`scripts/machine-sim.mjs` stands up a fleet that speaks exactly what an enrolled runtime
speaks: it joins with a single use token, beats every minute, and sends signed batches of
actions every ten seconds while its agents work. It is how a limit is found on staging rather
than by a customer.

## Running it

```sh
# An admin's bearer token for the workspace the fleet joins.
pnpm machine-sim enrol --url https://staging.example --workspace <ws> --admin-token <t> --machines 30000
pnpm machine-sim run --minutes 30 --agents 3 --actions-per-minute 2 --held 0.01 --active 0.3
pnpm machine-sim revoke --admin-token <t>
```

It refuses a host that is neither localhost nor named staging unless `--allow-host` names it.
Machines and their keys are kept in `$TMPDIR/memnox-machine-sim.json`, never in a repository.
One simulator process holds a few thousand machines comfortably; run several with their own
`TMPDIR` for the full fleet, so the simulator is never the bottleneck being measured.

## The fleet it stands for

100k agents at about three per machine is about 33k machines. At the defaults that is about
550 heartbeats a second, up to about 1,000 event posts a second with 30% of machines active,
and about 350 action rows a second on average. A peak hour runs several times the average, so
the run worth trusting is one at five times the defaults' row rate.

## What passing means

| Route | p99 | Errors |
|---|---|---|
| heartbeat | under 300 ms | under 0.1% |
| events | under 500 ms | under 0.1%, and no 413 |
| join | under 1 s | none |

Watch the database alongside it: connections in use against the pool, the largest event log
partition, and autovacuum on it. A route that passes while the pool is at its ceiling has not
passed; it is the next minute's outage.

## What it does not cover

Phones and the relay, which `scripts/phone-sim.mjs` drives one at a time, and the console's
own reads, which a browser or a separate script should load while this runs.
