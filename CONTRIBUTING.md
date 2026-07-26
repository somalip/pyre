# Contributing to pyre

## Prerequisites

- macOS development environment
- Node.js >= 18
- npm >= 9
- `tsup` and `tsx` installed via devDependencies

## Clone and install

```bash
git clone https://github.com/somalip/pyre.git
cd pyre
npm ci
```

## Project structure

```
src/
  index.ts      # CLI entry (commander)
  monitors.ts   # macOS system collectors (cpu, memory, disk, thermal, battery, network, processes)
  formatters.ts # Table, JSON, CSV, TSV output
  live.ts       # Live redraw dashboard
dist/           # Build output (gitignored)
Formula/        # Homebrew formula
```

## Build

```bash
npm run build   # tsup → dist/index.js (ESM)
```

## Run from source

```bash
npx tsx src/index.ts            # Dev run (no build needed)
node dist/index.js              # Run built bundle
```

## Common commands

```bash
npx tsx src/index.ts                          # table view
npx tsx src/index.ts --detailed               # detailed with powermetrics temps
npx tsx src/index.ts --json                   # JSON output
npx tsx src/index.ts --csv > stats.csv        # export CSV
npx tsx src/index.ts --tsv > stats.tsv        # export TSV
npx tsx src/index.ts live --interval 3        # live mode, 3s refresh
```

## Lint / test

```bash
npm test         # smoke test: --help exits 0
```

## Dependencies

- Runtime: `chalk`, `commander`
- Dev: `@types/node`, `tsup`, `tsx`, `typescript`

## Notes

- macOS system info is gathered via native CLI tools (`sysctl`, `top`, `pmset`, `vm_stat`, `df`, `ps`, `netstat`, `powermetrics`).
- `--detailed` mode attempts `powermetrics --samplers smc`, which may require `sudo`.
- Live mode uses ANSI escape codes to redraw the terminal.
