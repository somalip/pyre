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