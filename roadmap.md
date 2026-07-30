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

- [ ] **Multi-host dashboard** — tile stats from several Macs at once in one view,
      built on the existing P2P/SSH streaming. btop has no native equivalent.
- [ ] **Anomaly detection surfaced in UI** — `src/anomalies.ts` already exists;
      turn it into a "what changed since yesterday/last week" report.
- [ ] **Alert webhooks/hooks** — run a shell command or POST to a URL on alert
      trigger (Slack, PagerDuty, etc.) for basic automation.
- [ ] **Configurable panel layout** — resize/hide/reorder dashboard panels instead
      of a fixed layout.
- [ ] **Menu bar / background daemon mode** — lightweight always-on stats display
      outside the terminal. Genuinely differentiates from a pure-TUI tool, but is
      the largest engineering lift (likely needs a native helper or Electron/tray shim).

## Housekeeping (ongoing, not blocking)

- [ ] Man page / expanded `--help` grouped by use case
- [ ] Confirm Brewfile is tap-installable end to end
- [ ] Keep `parity.md` updated as Tier 1/2 items land, so the btop comparison
      stays accurate rather than aspirational