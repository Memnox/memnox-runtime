# Risk bands

A band is not a score. It is the strongest rule that fired, and every rule names the
count that made it fire, so the band can be argued with rather than trusted.

There is no publisher reputation here, no install count and no comparison between
products. This machine cannot see any of those, and a number invented from them would
be exactly the score this product does not ship.

## The rules

Evaluated in order. All of them run; the band is the strongest one that fired.

| Rule | Fires when | Band |
|---|---|---|
| `auto-approve` | an agent's own setting says it acts without asking | HIGH, CRITICAL with a secret in reach |
| `model-approves` | an agent's own setting hands the permission prompt to a model | HIGH |
| `desktop-control` | an agent holds a server that both sees the screen and presses keys | HIGH, CRITICAL when that agent asks nobody first |
| `destructive-tool` | any tool is classified `destructive` | CRITICAL |
| `secret-reachable` | a path above `ordinary` sensitivity is reachable by an agent here | CRITICAL |
| `combined-capability` | a set of individually ordinary tools opens a path together | HIGH |
| `write-tool-with-credential` | a write tool exists and some server is handed a credential | HIGH |
| `shell-surface` | an agent holds a shell, which reaches everything you can | HIGH |
| `unprobed-server` | a server was never started, so its tools are unknown | MEDIUM |
| `unrestricted-egress` | nothing restricts or observes outbound traffic, and tools exist | MEDIUM |
| `write-tool` | a tool changes external state, with no credential beside it | MEDIUM |
| *(none fired)* | | LOW |

## Why these and not others

**Unprobed is MEDIUM, not LOW.** Zero tools on a server nobody started means unknown,
not harmless. Reporting it as low would be the one lie that matters most, because it is
the case where the reader has the least information and the most confidence.

**Egress only counts when something could use it.** An unrestricted network on a machine
with no tools is a fact about the machine, not a finding about an agent.

**Combined capability is HIGH, and only counts chains nothing else caught.** A chain
containing a step that is already destructive fires `destructive-tool` instead. What is
left is the case with no other rule behind it: every step passes review on its own, so
without this rule the band would be decided as though the path were not there. See
[Harnesses](harnesses.md#combined-capability) for how a chain is read.

**A model answering the prompt is its own fact.** Under Claude Code's `auto` mode a
model decides what a person would have been asked, and the person sees only what it
leaves. That is neither asking nor acting alone, so it is neither `asks` nor `auto` in
the posture and has its own rule. This product keeps models off every decision path,
and the one place a model is deciding on this machine deserves its own line.

**The desktop is a surface nothing here holds.** A server whose tools both see the
screen and press keys reaches every window on the machine, the password manager and
the terminal included, through the platform's own accessibility and input APIs. No
wrapper, proxy or kernel profile sits in front of that, so `memnox explain` prints the
seam as absent rather than open, with no next step, and the band says HIGH on its own.
Held by an agent that asks nobody first it is CRITICAL, because then nothing stands
between a prompt injection and the keyboard. It is read off tool names after a probe,
so a server nobody started cannot produce it, and a browser driver's clicks stay with
the browser seam that already holds them.

**A credential raises a write tool but does not create one.** `write-tool-with-credential`
is HIGH because the pair is what turns a mistake into somebody else's incident. Either
half alone is MEDIUM.

**Nothing here sums.** Three MEDIUM rules do not make a HIGH. A band that could be
inflated by counting would push a reader toward the noisy machine rather than the
dangerous one.
