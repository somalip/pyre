# pyre — Next Features: Beating macmon & btop (v10 planning doc)

**Audience:** a coding agent picking up this repo cold, handed only this file.
**Goal:** close the one real competitive gap pyre still has (macmon's sudoless,
Apple-Silicon-native depth), while also giving the "I just want to know if my
Mac is okay" crowd something simpler than the current power-user-first dashboard.

**Companion docs already in this repo** — read this file first, they fill in detail:

| Doc | What it covers |
|---|---|
| `README.md` | Current shipped feature list |
| `parity.md` | Full btop feature audit + "what pyre has that btop can't" |
| `roadmap.md` | Tier 1–3 btop-parity backlog — **fully shipped**, all boxes checked |
| `advanced.md` | Tracks A–H post-parity roadmap (security, Apple Silicon, ecosystem, DevOps, distribution, UX, AI, moonshots) — several phases still open |

None of the above ever mentions **macmon** by name or compares against it — that's
the gap this document exists to close. It also explicitly separates features by
*who they're for*, which `advanced.md`'s difficulty-only tagging doesn't do.

---

## 0. How to use this document

1. Work tier-by-tier, top to bottom — tiers are ordered cheapest-and-highest-impact
   first, same convention as `roadmap.md`.
2. Every feature has a **Difficulty** (same legend as `advanced.md`, repeated below
   so this file works standalone) and an **Audience** tag:
   - **[Simple]** — for someone who wants a glance-and-go answer, not a dashboard
   - **[Power]** — for someone who already lives in `pyre live`
   - **[Both]** — benefits everyone, usually plumbing or a shared surface
3. Don't duplicate work already tracked in `advanced.md` — where a feature overlaps
   (e.g. Apple Silicon depth), this doc says so explicitly and adds only the
   macmon-specific bar to clear, instead of re-explaining the whole feature.
4. When something in Section 1's comparison table gets closed, update this file's
   table row *and* `parity.md`'s "what pyre can't do" framing if it changes — keep
   the "beats btop and macmon" claim honest, not aspirational.

### Difficulty legend

| Tag | Meaning | Rough effort |
|---|---|---|
| **XS** | Trivial, mostly wiring existing data | < 4 hours |
| **S** | Small, one module, no new architecture | 0.5–2 days |
| **M** | Medium, new module + UI surface + tests | 3–7 days |
| **L** | Large, cross-cutting or new subsystem | 1–3 weeks |
| **XL** | Moonshot | 3+ weeks |

---

## 1. Where pyre stands today — pyre vs btop vs macmon

| Capability | pyre | btop | macmon |
|---|---|---|---|
| Needs sudo for temps/power | **Yes** (powermetrics) | No | No (private IOReport API) ⚠️ |
| Prometheus `/metrics` endpoint | No | No | **Yes** ⚠️ |
| Continuous JSON stream for scripting (`\| jq`) | No (snapshot only) | No | **Yes** (`macmon pipe`) ⚠️ |
| Auto-start as background service | No (xbar plugin only) | No | **Yes** (`--install` launchd) ⚠️ |
| Per-cluster (E/P) CPU % + frequency | No (flat aggregate) | No | **Yes** ⚠️ |
| Neural Engine (ANE) power | No | No | **Yes** ⚠️ |
| Plain-English "is it healthy" summary | No | No | No — **open for anyone** |
| Process kill / tree / search / signals | **Yes** | Yes | No ✅ |
| Full multi-panel dashboard (disk/net/battery/packets) | **Yes** | Yes | No (CPU/GPU/mem/temp only) ✅ |
| Remote / multi-host / P2P streaming | **Yes** | No | No ✅ pyre-only |
| Security & ecosystem inspectors (doctor/extensions/brew) | **Yes** | No | No ✅ pyre-only |
| Native compiled binary, zero runtime dependency | No (Node) | Yes (C++) | Yes (Rust) ⚠️ |

**Reading this table:** pyre's breadth already beats both tools combined — that
story is already told well in `parity.md`. The entire open gap sits in one lane:
**sudoless, Apple-Silicon-native depth**, which is macmon's whole reason to exist.
Track M below closes that lane. Everything else in this doc is either a simple-user
gap neither competitor has bothered with, or genuine new ground past both.

---

## 2. Tier 0 — do this before anything else here

Don't re-litigate this — `advanced.md` Section 2 already flags two `roadmap.md`
checkboxes as thinner than they claim:

- **P0-1**: `pyre fleet` is sequential SSH+`--once` polling, not a real concurrent
  tiled dashboard, despite the roadmap checkbox.
- **P0-2**: `src/anomalies.ts` has no digest/report command surface yet.

Fix those first so this document isn't building differentiation on top of an
already-oversold feature. Full detail is in `advanced.md`, not repeated here.

---

## 3. Track M — macmon parity & Apple Silicon depth (new — not in any other doc)

### M1. Sudoless power/thermal via private IOReport API
**Difficulty: L · Audience: [Both]**

Every temp/power reading in pyre currently goes through `sudo -n powermetrics`
(`src/monitors/smc.ts`), which silently returns nothing for anyone without
passwordless sudo configured in `/etc/sudoers`. This is the single biggest
practical gap versus macmon, whose entire pitch is "sudoless" — it (and mactop,
socpowerbud) reads CPU/GPU/ANE power and per-cluster usage from Apple's private
`IOReport` framework instead of shelling out to `powermetrics` and parsing text.
In Node this means a small native addon (N-API) or a compiled Swift/C helper
binary shipped next to `dist/` and talked to over IPC — real systems work, not
glue code. Treat it as its own spike before committing to shipping it.

**DoD:** `pyre` shows CPU/GPU wattage and per-cluster usage with zero sudo prompt
on a clean test account with no sudoers entry; the existing powermetrics path
stays as an automatic fallback for anything IOReport doesn't expose.

### M2. E-core / P-core cluster usage + frequency, with dual usage metrics
**Difficulty: S/M · Audience: [Power]**

Overlaps `advanced.md`'s B1, but macmon's version is the concrete bar to clear:
per-cluster **frequency (MHz)** *and* two distinct numbers — "effective usage"
(frequency-scaled) versus "active residency ratio" (not frequency-scaled). Most
tools blend these into one percentage; exposing both is what actually reads as
Apple-Silicon-native instead of a generic CPU bar wearing a Mac skin. Can ship
today on `sysctl hw.perflevel{0,1}.physicalcpu` + the existing powermetrics path,
then swap to M1's data source once that lands.

**DoD:** live dashboard shows two labeled clusters, each with its own frequency
and both usage numbers; Intel Macs fall back to one undifferentiated cluster,
matching current behavior.

### M3. ANE (Neural Engine) power draw
**Difficulty: S once M1 lands · Audience: [Power]**

Already flagged as B2 in `advanced.md`; listed here because macmon ships this
**today** and pyre doesn't — this is catch-up, not hypothetical differentiation.
Directly relevant to local-LLM/Core ML users, which is macmon's own stated
motivation for existing in the first place.

**DoD:** shows `0` gracefully instead of omitting the row where unsupported.

### M5. Prometheus `/metrics` endpoint
**Difficulty: M · Audience: [Power]**

Already flagged as D1 in `advanced.md`'s DevOps track — pulled forward here
because macmon's `serve` subcommand ships this **today**, with a working
Prometheus+Grafana example in its own repo as proof this is table stakes for
the category now, not a nice-to-have. pyre already ships a Grafana dashboard
JSON (`grafana/pyre-dashboard.json`) built for polling ingestion — a `/metrics`
endpoint is a more natural fit for that file than the current SSE-only `pyre web`.

**DoD:** `curl localhost:3000/metrics` returns valid Prometheus text-exposition
format; the existing SSE dashboard route keeps working unchanged.

---

## 4. Tier 1 (XS–S) — quick wins for the simple/casual-user side

Most of pyre's feature list (P2P, fleet, security inspectors) is power-user
territory — a real strength, but it means someone who just wants "is my Mac
okay?" wades through more surface area than macmon or even btop force on them.
These are cheap ways to close that gap without touching architecture.

---

## 5. Tier 2 (M) — power-user differentiation past *both* competitors

Not macmon catch-up (that's Track M) — genuine new ground, using data pyre
already half-collects.

### P1. Per-process GPU/ANE attribution
**Difficulty: M/L · Audience: [Power]**

macmon's ANE/GPU power is system-wide only; btop doesn't attribute GPU load to
processes either. Cross-reference `system_profiler SPDisplaysDataType`'s
process count (already read in `collectGpu()`) with the process table to show
which processes are actually driving GPU/ANE load — useful for "why is my fan
spinning during this LLM run," and something neither competitor offers at all.

**DoD:** at minimum flags which top-N processes are plausibly GPU/ML-heavy even
if exact per-process wattage isn't obtainable from public APIs.

### P2. Historical avg/max annotations directly on live graphs
**Difficulty: S/M · Audience: [Both]**

macmon's historical charts show running average and max on the chart itself.
pyre's `history.ts`/`sparkline.ts` already track a rolling buffer for the live
session — surfacing "avg 34% · max 91%" next to each live graph (not only in
the separate `pyre history` command) is a small addition with an immediate
payoff for anyone glancing at the dashboard mid-session.

**DoD:** labels update live with no noticeable render-loop slowdown; works for
both sparkline and bar graph modes (`g`/`b` toggles).

### P3. Compact "widget" window mode for `pyre ui`
**Difficulty: S · Audience: [Both]**

macmon supports a small persistent window; `test_ui.swift`/`pyre ui` already
wraps the web dashboard in a native `NSWindow` — add a compact size preset plus
an "always on top" toggle so it can sit in a screen corner like a widget,
reusing S4's `--minimal` panel set as its default content.

**DoD:** compact mode persists window position/size across relaunches (a small
state file next to the config, no new dependency).

---

## 6. Tier 3 and beyond

Everything at native-binary/daemon/companion-app scale — standalone compiled
binary, menu bar companion, iOS/watch companion — is already tracked in
`advanced.md` Tracks E and H. Don't fork a second version of that plan here.
One sequencing note worth flagging: once **M1** (sudoless IOReport) lands,
`advanced.md`'s **E1** (standalone compiled binary) gets meaningfully easier,
because a native IOReport helper is most of the packaging work a
single-executable build needs anyway. **Sequence E1 after M1, not before.**

---

## 7. Suggested build order

1. **Tier 0** (`advanced.md` P0-1/P0-2) — repair before extending.
2. **S1 / S2** (`pyre check` + exit code) — cheapest win available, zero
   dependencies, immediately closes the simple-user gap.
3. **M4, M7, M6** (`pyre pipe`, `pyre stress`, `--install`) — all XS/S, no
   architecture changes, closes visible macmon-checklist gaps fast.
4. **M1** (sudoless IOReport) — the one real spike in this document; do it once,
   in isolation, before M2/M3/E1 all start depending on it.
5. **M2, M3, M5** — land on top of M1.
6. **S3, S4, S5, S6** — simple-user polish; safe to run in parallel with the
   above since it touches `formatters/`/`render`/config wizard, not
   `monitors/collectors`.
7. **P1, P2, P3** — power-user differentiation *after* the macmon checklist is
   actually closed, not before — shipping novel depth while a competitor's
   table-stakes feature is still missing is the same credibility gap
   `parity.md` warns about for btop.

---

## 8. Guardrails (same spirit as `advanced.md`, repeated so this file stands alone)

- Every sudo-adjacent feature (fallback powermetrics paths, etc.) must degrade
  through `pyre doctor`, never crash.
- **M1 is additive.** The existing powermetrics path must keep working for
  anyone without the new native helper built/available for their arch (Rosetta,
  unusual entitlement setups) — don't drop the fallback the day IOReport
  support lands.
- No feature in this document should require Full Disk Access, sudo, or any
  TCC grant *to run pyre at all*.
- Update Section 1's comparison table as items land — a stale "we beat X"
  table is worse than no table, same rule `parity.md` already follows for btop.