# pyre v8 — Becoming the Definitive Mac CLI System Monitor

**Audience:** a coding agent picking up this repo cold.
**Goal:** don't just match btop — make pyre the tool a Mac power user, sysadmin, or
developer reaches for by default, on features btop structurally cannot offer because
it isn't Mac-native.

This doc was produced by auditing the actual `src/` tree against `README.md`,
`parity.md`, and `roadmap.md` (not just reading the checkboxes), then adding new
tracks the existing roadmap never considered. Read this in full before writing code —
Section 1 tells you what's real vs. thin, so you don't re-implement things that
already exist or trust a `[x]` that doesn't mean what it says.

---

## 0. How to use this document

1. Work top to bottom by **Phase** (Section 12), not by track — phases are ordered
   for maximum differentiation-per-hour-of-work.
2. Every feature has a **Difficulty** tag and a **Definition of Done**. Don't mark
   something complete until DoD passes.
3. Every feature that touches permissions (TCC, sudo, entitlements) must degrade
   gracefully and explain itself via `pyre doctor` — never crash or silently no-op.
4. Update `README.md`, `parity.md`, and this file's checkboxes as you land features.
   Keep `parity.md` honest — it's the thing that makes the "beats btop" claim credible.
5. Add or extend tests where the codebase already has a pattern for it
   (`src/p2p/server.test.ts` is the only existing test — treat new modules as a
   chance to actually build test coverage out, see Section 13).

### Difficulty legend

| Tag | Meaning | Rough effort |
|---|---|---|
| **XS** | Trivial, mostly wiring existing data | < 4 hours |
| **S** | Small, one module, no new architecture | 0.5–2 days |
| **M** | Medium, new module + UI panel + tests | 3–7 days |
| **L** | Large, cross-cutting or new subsystem | 1–3 weeks |
| **XL** | Moonshot — likely its own repo/companion app | 3+ weeks |

---

## 1. Current state audit (ground truth, not the checkbox list)

pyre is already well past a typical btop clone: P2P streaming, SSH remote dashboard,
a web dashboard with SSE, benchmarking, xbar integration, and six themes are all real
and none of these exist in btop at all. `parity.md`'s own "What btop does NOT do"
list is actually a gap list for **both** tools — Activity Monitor covers several of
those, pyre covers none of them yet. That list is the seed for Track A below.

Two things marked `[x]` in `roadmap.md` are thinner than the checkbox implies —
fix these first so the README doesn't overstate the product:

- **`pyre fleet` is not a live tiled dashboard.** `src/fleet.ts` is 31 lines: it
  SSHes into each host sequentially, runs `pyre --once --json`, and prints one
  static table per host. There's no concurrency, no refresh loop, no true grid
  layout. The roadmap entry ("tile stats from several Macs at once") oversells
  this. See **P0-1**.
- **Anomaly detection has no digest/report surface.** `src/anomalies.ts` computes
  z-scores and it *is* wired into the live dashboard's alert panel — that part is
  real. But the roadmap's stated goal ("turn it into a 'what changed since
  yesterday/last week' report") was never built; there's no command that reads
  historical CSVs and produces a summary. See **P0-2**.

Also confirmed **absent** anywhere in `src/`: Docker awareness, launchd/launch
agent inspection, TCC/privacy auditing, code-signing checks, Wi-Fi/Bluetooth
panels, Prometheus/metrics export, mDNS discovery, Homebrew awareness, Time
Machine status, E-core/P-core cluster splitting, and any AI-assisted diagnosis.
Every one of these is a green-field feature, not a "finish the stub" job.

---

## 2. PRIORITY 0 — Repair before you extend

### P0-1: True concurrent live Fleet dashboard
**Difficulty: M**
Rebuild `pyre fleet <host1> [host2]...` to open persistent SSH/P2P streams to
each host (reuse the P2P client protocol or an SSH-tunneled stream, don't shell
out to `ssh host "pyre --once"` on every tick) and render a real grid — N panels
tiled by terminal size, each auto-refreshing on its own interval, offline hosts
shown greyed out with last-seen timestamp instead of dropped from the list.
**DoD:** killing/restoring network to one host doesn't freeze the others; grid
reflows on terminal resize; works with 1–8 hosts without redrawing flicker.

---

## 3. Track A — Security & Privacy (the biggest open differentiator)

Nothing in the CLI-monitor space — not btop, not htop, not `stats.app` — does
privacy/security posture. Activity Monitor does a bit of it via GUI dialogs no
one checks. This is the track most likely to make pyre get talked about.

### A1: Privacy audit — `pyre privacy`
**Difficulty: M**
List apps holding sensitive TCC permissions (Camera, Microphone, Screen
Recording, Accessibility, Full Disk Access) by reading the TCC database at
`~/Library/Application Support/com.apple.TCC/TCC.db` (read requires the running
terminal itself to have Full Disk Access — detect and explain this, don't fail
silently) or fall back to `tccutil` where available. Flag anything with Screen
Recording or Accessibility that isn't a well-known dev tool (Zoom, browsers,
IDEs) as worth a second look.
**Permissions:** requires Full Disk Access for the terminal running pyre.
Must be detected by `pyre doctor` and produce a one-line fix instruction.
**DoD:** works without sudo; degrades to "grant Full Disk Access to see this"
instead of a stack trace when the DB read is denied.

### A2: Live camera/mic in-use indicator
**Difficulty: S/M**
Surface which process currently holds the camera/microphone (mirrors the
green/orange menu-bar dot) as a live-dashboard panel line. Source via
`system_profiler SPCameraDataType` polling is too slow for live use — instead
poll process list for known media daemons (`appleh13camerad`,
`VDCAssistant`, `AppleCameraAssistant`) and cross-reference which parent app
triggered them where possible.
**DoD:** shows "camera active: <app>" within one refresh tick of camera use
starting/stopping in a real test (Photo Booth / Zoom).

### A3: Launch Agents & Daemons inspector — `pyre agents`
**Difficulty: M/L**
List everything in `~/Library/LaunchAgents`, `/Library/LaunchAgents`,
`/Library/LaunchDaemons`, and `/System/Library/LaunchDaemons`, cross-referenced
against `launchctl list` for what's actually loaded/running. Flag non-Apple,
unsigned, or recently-added entries (persistence mechanisms are a classic
malware/adware vector on Mac — this is a real "why is my fan spinning"
diagnostic tool). Support `pyre agents disable <label>` wrapping
`launchctl bootout`, gated behind a confirmation prompt.
**DoD:** read-only listing works with zero elevated privileges; disabling
requires explicit confirmation and never touches anything under
`/System/Library` without a loud warning.

### A4: Code-signing / notarization column for processes
**Difficulty: M**
Add a signed/unsigned + Developer Team ID column to the process panel
(`--detailed` or a toggle key), sourced from `codesign -dv --verbose=2 <path>`
resolved via the process's executable path (`ps -o comm=`/`lsof -p` for path
resolution). Unsigned or ad-hoc-signed processes get a visual flag.
**DoD:** doesn't add more than one extra `codesign` call per unique binary path
per refresh (cache by path+mtime); doesn't stall the render loop waiting on it.

### A6: Per-process network connection inspector — `pyre net` / live panel
**Difficulty: M/L**
Go beyond the existing packet-rate/top-talkers view: show a live table of
active connections — local port, remote host:port, protocol, state — mapped
to owning process, via `lsof -i -n -P` parsed properly (not just the
count-by-name aggregation `collectors.ts` currently does at line ~812) or
`nettop -x -l 1` for lower overhead. This is the single feature every "why is
this process phoning home" complaint needs.
**DoD:** correctly attributes at least TCP ESTABLISHED and LISTEN states to
PIDs; doesn't require sudo for a user's own processes.

---

## 4. Track B — Apple Silicon depth (things Activity Monitor half-does and btop can't do at all)

### B1: E-core / P-core cluster split
**Difficulty: S/M**
Apple Silicon exposes cluster info via `hw.perflevel0.physicalcpu` (performance
cores) and `hw.perflevel1.physicalcpu` (efficiency cores). Extend
`collectCpu()` to label which indices in `coreUsage[]` belong to which
cluster and render two grouped bar clusters instead of one undifferentiated
row. This is more informative than what Activity Monitor shows by default.
**DoD:** falls back cleanly (single cluster, current behavior) on Intel Macs
where these sysctls don't exist.

### B2: Neural Engine & Media Engine utilization
**Difficulty: M**
`powermetrics --samplers ane_power,gpu_power` (already used for GPU/power
data) also exposes ANE (Neural Engine) power draw. Surface it as a line in
the Power panel — nothing else in this space shows ANE usage at all, and it's
increasingly relevant with more on-device ML tooling (Core ML, local LLMs).
**Permissions:** requires the same sudo/powermetrics access `--detailed`
already needs — no new permission story, just new fields.
**DoD:** shows `0` gracefully on hardware/software where the sampler is
unavailable rather than omitting the row inconsistently.

### B3: Per-app Energy Impact score
**Difficulty: M/L**
Reconstruct Activity Monitor's "Energy" tab: a composite score per process
from CPU time, wakeups-from-idle (`powermetrics --samplers
tasks,cpu_power`), and GPU time where attributable. Exact weighting doesn't
need to match Apple's private formula — a documented, consistent relative
score ("this process is your #1 energy consumer this session") is the value,
not bit-for-bit parity.
**DoD:** ranks match user-observable reality in a manual smoke test (e.g., a
video call or Chrome with many tabs should visibly outrank an idle terminal).

### B5: Thermal throttling correlation
**Difficulty: M**
When `pmset -g therm` or the SMC thermal state indicates throttling, snapshot
the top 3 CPU/GPU processes at that moment and attach them to the event in
the anomaly/alert history, so "why did my Mac throttle at 3:14pm" has an
actual answer instead of just a timestamp.
**DoD:** throttle events in `pyre history` show attributed processes when
available, and clearly say "no process snapshot captured" otherwise (don't
fabricate).

### B6: Wi-Fi link quality panel
**Difficulty: S/M**
RSSI, noise, negotiated PHY rate, channel/band, via `wdutil info` (modern
replacement for the deprecated `airport` command) — useful for diagnosing
"why is my connection slow" without leaving the terminal.
**Permissions:** `wdutil info` requires sudo on recent macOS — must be gated
the same way `--detailed`/powermetrics already is, and skip gracefully
without it.
**DoD:** degrades to "run with sudo/--detailed for Wi-Fi diagnostics" rather
than an error when unprivileged.

### B7: Bluetooth peripheral battery panel
**Difficulty: S/M**
Battery percentage for connected AirPods/mice/keyboards/trackpads via
`system_profiler SPBluetoothDataType`. Genuinely useful and something no
terminal monitor currently surfaces at all.
**DoD:** handles zero, one, or many connected devices; missing battery data
for a device (not all peripherals report it) doesn't break the panel.

---

## 5. Track C — Ecosystem awareness

### C1: Docker / OrbStack container panel
**Difficulty: S/M**
If `docker` (or `orb`) is on PATH and the daemon is reachable, add a
container panel: name, CPU%, mem, network I/O via `docker stats --no-stream
--format json`. Mac developers running containers locally are a large slice
of the "would install a fancier btop" audience.
**DoD:** panel is simply absent (not an error) when no container runtime is
installed or running.

### C4: Virtualization awareness
**Difficulty: M**
Detect running VMs (Parallels, UTM, VMware Fusion, Apple's Virtualization
framework guests) via process inspection and surface aggregate resource
consumption per VM in the process/tasks panel, since VM host processes
otherwise just look like one big opaque process.
**DoD:** at minimum correctly labels the process as "VM: <name>" where the
hypervisor exposes a guest name; full per-VM CPU/mem breakdown is a stretch
goal within this ticket, not a blocker.

### C5: Per-process file descriptor / socket count + leak flag
**Difficulty: S/M**
`lsof -p <pid> | wc -l` per top process (cached, rate-limited) plus the
process's `RLIMIT_NOFILE`. Flag processes trending toward their limit across
the live session — a real "why did this daemon just die" diagnostic.
**DoD:** doesn't call `lsof` per-process every tick for the full process list
— sample only the visible/top-N rows to avoid overhead.

---

## 6. Track D — DevOps & observability integrations

This is where pyre stops being "a nicer btop" and starts being infrastructure.

### D1: Prometheus-compatible metrics endpoint
**Difficulty: M**
`pyre web --prometheus` (or a separate `--port`) exposes `/metrics` in
Prometheus text exposition format alongside the existing SSE dashboard.
Instantly makes every Mac running pyre scrapeable into an existing
Grafana/Prometheus stack — something no terminal-only tool offers.
**DoD:** output validates against `promtool check metrics` (or equivalent
format linter) if available in CI; falls back to documenting manual
validation if not.

### D2: mDNS/Bonjour auto-discovery for P2P & Fleet
**Difficulty: M**
Advertise a pyre P2P server via Bonjour (`dns-sd`/`bonjour` service
registration, e.g. `_pyre._tcp`) so `pyre fleet --discover` or `pyre p2p
connect --discover` finds peers on the LAN without the user copy-pasting an
IP from `pyre server`. Big UX win for the multi-Mac features that already
exist.
**DoD:** discovery works across a 2-machine LAN test; manual IP entry still
works as a fallback (don't remove it).

---

## 7. Track E — Distribution & installation

btop's biggest practical advantage is zero-dependency install. Close that gap.

### E1: Standalone compiled binary
**Difficulty: L**
Ship a self-contained binary (via `bun build --compile` or a Node
single-executable-application build) so `brew install pyre` doesn't pull in a
Node 18+ runtime requirement. This is the single highest-leverage item for
adoption — "needs Node" is the #1 reason a tool like this loses to a native
binary.
**DoD:** binary runs on a clean macOS install with no Node/npm present;
`npm install -g pyre-cli` path continues to work for those who prefer it.

### E2: Homebrew Core readiness
**Difficulty: S/M**
Audit the existing `Formula/` tap against Homebrew Core's acceptance bar
(notability, test block, no vendored deps, versioned releases) and prepare/
submit the PR. Being in `brew install pyre` directly (no `brew tap` step)
meaningfully lowers install friction versus a custom tap.
**DoD:** `brew audit --strict --new` passes locally against the formula.

### E4: Signed & notarized releases
**Difficulty: M**
If shipping a compiled binary (E1), sign and notarize it so Gatekeeper
doesn't throw a scary "unidentified developer" dialog on first run — ironic
for a security-conscious tool to trip that warning itself.
**DoD:** `spctl -a -vv <binary>` reports accepted/notarized.

---

## 8. Track F — UX, accessibility & safety

### F2: Command palette in the live dashboard
**Difficulty: M**
A `:`-triggered fuzzy action launcher (à la vim/command palettes) that maps
to every existing keybinding plus new commands (jump to panel, change theme,
start P2P server, export) — reduces the surface area of "which single-letter
key was that again" as feature count grows.
**DoD:** every existing single-key action is reachable through the palette
with no regressions to the direct keybindings.

---

## 9. Track G — Intelligence layer

### G2: Optional AI-assisted explain command
**Difficulty: M/L**
`pyre explain` sends a redacted snapshot (metrics + top process names only —
no arbitrary file contents, no user data) to an LLM API using a key the user
supplies (`~/.config/pyre/config.json` or an env var), returning a
plain-English diagnosis of what's driving current resource use. **Must be
fully opt-in**: no network call happens unless a key is configured and the
command is explicitly invoked; document exactly what leaves the machine.
**DoD:** with no key configured, the command explains how to set one up and
makes zero network calls; with a key configured, a clear one-line notice
states what data is being sent before the first call in a session.

---

## 10. Track H — Moonshots (treat as a separate workstream / repo)

These make pyre something Activity Monitor and btop both structurally can't
be. They're real differentiators but sized to derail everything else on this
list if tackled early — sequence last, and consider a companion repo so the
core CLI's release cadence isn't blocked on them.

### H1: Native menu bar companion (no xbar/SwiftBar dependency)
**Difficulty: XL**
A small Swift/SwiftUI menu bar app that talks to a lightweight pyre
background daemon over a Unix domain socket (the daemon already has all the
collector logic — this is a UI shell, not a rewrite). Removes the xbar/
SwiftBar dependency entirely for users who just want a menu bar readout.

### H2: iOS/watch companion via existing P2P protocol
**Difficulty: XL**
A minimal SwiftUI iOS/watchOS app that speaks the existing P2P client
protocol (`src/p2p/protocol.ts` — length-prefixed JSON over TCP with HMAC
signing) to show a Mac's live stats on a phone or watch. The protocol
already exists; this is a new client, not new server work.

### H3: Shortcuts/App Intents automation hooks
**Difficulty: XL**
Expose alert triggers and snapshot data as macOS Shortcuts actions (via a
thin helper app providing App Intents), so alert-driven automations don't
require the user to already know `--alert-cmd`/webhooks exist.

---

## 11. Suggested build order (phased)

| Phase | Contents | Why this order |
|---|---|---|
| **Phase 1** | P0-1, P0-2, F1, F4, C3, B8, B4 | Repair the two overstated features first; cheap, safe wins that ship fast and don't touch permissions. |
| **Phase 2** | A5, A7, A1, A3, A6, B1, B6, B7 | The security/privacy + Apple Silicon depth tracks — this is the actual "reason to switch from btop" story. |
| **Phase 3** | A2, A4, B2, B3, B5, C1, C2, C5 | Rounds out the differentiation with energy/process-level depth and dev-ecosystem awareness. |
| **Phase 4** | D1–D5, E2, E3 | Turns pyre into infrastructure (scrapeable, profile-able) and lowers install friction. |
| **Phase 5** | E1, E4, F2, F3, G2 | Bigger distribution lift (standalone binary) and polish once the feature set is stable. |
| **Phase 6 (separate track)** | H1–H3 | Moonshots — start only once Phases 1–5 are stable and shipped. |

---

## 12. Non-goals / guardrails

- **Don't chase Linux/FreeBSD parity.** btop's cross-platform reach isn't the
  battle to fight — pyre's edge *is* being Mac-native. Stay Mac-only.
- **Don't request Full Disk Access, sudo, or any TCC grant by default.**
  Every privileged feature (A1, A3-partial, B2, B6) must be additive and
  self-explaining via `pyre doctor`, never a hard requirement to run the tool
  at all.
- **No kernel extensions, no `dtrace`/`dtruss`.** SIP restrictions make these
  fragile and support-heavy for a CLI tool distributed via npm/Homebrew — the
  features above get 90% of the diagnostic value without them.
- **No silent telemetry.** Version checks (E3) and AI calls (G2) are the only
  things that should ever touch the network unsupervised, and both must be
  opt-in and clearly disclosed.
- **AI features are additive, never load-bearing.** G2 should never be
  required to interpret pyre's own output — it's a convenience layer on top
  of data the tool already displays in plain form.

---

## 13. Testing note

The repo currently has exactly one test file (`src/p2p/server.test.ts`). As
you build each feature above, add a test alongside it wherever the logic is
pure/testable (parsers for `lsof`/`system_profiler`/`vm_stat` output, the
z-score digest logic, config profile load/save, Prometheus format output) —
these are exactly the kind of shell-output-parsing code that silently breaks
on the next macOS point release, and there's currently no safety net for any
of it.