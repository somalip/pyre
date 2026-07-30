# pyre Roadmap

A prioritized plan for closing the gap with btop and pushing past it. Organized by
effort vs. impact rather than by category, so it's usable as an actual work queue.

## Tier 1 — Quick wins (small effort, closes visible gaps)

- [x] **Disk I/O throughput** — read/write speed per volume, not just space used.
      btop shows this; pyre currently only shows static usage.
- [x] **Per-core CPU bars/graph** — pyre shows aggregate CPU; per-core mini-bars are
      one of btop's most recognizable visuals.
- [x] **Process search-as-you-type** — filter the live process list by name while typing,
      distinct from the existing sort options.
- [x] **Persistent config file** (`~/.config/pyre/config.json` or similar) — save
      preferred theme, interval, alert thresholds, sort key, so flags aren't
      re-passed every run.
- [x] **Shell completions** — zsh/bash/fish, low effort with commander/yargs-style CLIs.
- [x] **`pyre doctor`** — checks sudo/powermetrics access, TCC permissions, network
      reachability for P2P, and explains what's degraded and why. Cheap to build,
      high value for support burden.

## Tier 2 — Medium effort, strong differentiation

- [x] **Custom theme files** — user-authored themes in `~/.config/pyre/themes/`,
      not just the six built-ins.
- [x] **Historical trend view** — replay/query past CSV logs into a graph over
      days or weeks (`pyre history --days 7`), rather than only the live session window.
      Builds directly on the export/logging system that already exists.
- [x] **`pyre diff`** — compare two exported snapshots side-by-side (e.g. before/after
      a build or deploy). Simple to implement given existing export formats.
- [x] **Process resource watchdog** — alert or auto-log when a *named* process
      crosses a CPU/mem threshold, not just system-wide alerts.
- [x] **Battery health trend** — chart cycle count / max capacity over time from
      logged snapshots, to predict degradation. Leans into the Mac-specific angle
      btop can't match.
- [x] **Live web dashboard** — upgrade `pyre web` from a static snapshot to an
      auto-refreshing page, so it's genuinely useful on a second monitor.

## Tier 3 — Bigger bets (high effort, high differentiation)

- [x] **Multi-host dashboard** — tile stats from several Macs at once in one view,
      built on the existing P2P/SSH streaming. btop has no native equivalent.
- [x] **Anomaly detection surfaced in UI** — `src/anomalies.ts` already exists;
      turn it into a "what changed since yesterday/last week" report.
- [x] **Alert webhooks/hooks** — run a shell command or POST to a URL on alert
      trigger (Slack, PagerDuty, etc.) for basic automation.
- [x] **Configurable panel layout** — resize/hide/reorder dashboard panels instead
      of a fixed layout.
- [x] **Menu bar / background daemon mode** — lightweight always-on stats display
      outside the terminal. Genuinely differentiates from a pure-TUI tool, but is
      the largest engineering lift (likely needs a native helper or Electron/tray shim).

## Housekeeping (ongoing, not blocking)

- [x] Man page / expanded `--help` grouped by use case
- [x] Confirm Brewfile is tap-installable end to end
- [x] Keep `parity.md` updated as Tier 1/2 items land, so the btop comparison
      stays accurate rather than aspirational