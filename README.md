# pyre

Mac system monitoring CLI: temps, CPU, memory, disk, battery, live dashboard, and export.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![macOS](https://img.shields.io/badge/macos-14%2B-lightgrey)
![Node](https://img.shields.io/badge/node-18%2B-green)

## Install

### npm
```bash
npm install -g pyre-cli
```

### curl
```bash
curl -fsSL https://raw.githubusercontent.com/somalip/pyre/main/install.sh | bash
```

### Homebrew
```bash
brew tap somalip/tap
brew install pyre
```

## Usage

```bash
pyre                      # Show all system stats
pyre --detailed           # Include sensor / powermetrics detail
pyre --json               # JSON output
pyre --csv                # CSV export
pyre live                 # Live monitoring dashboard
pyre live --interval 3    # Live with custom interval (seconds)
```

### Output includes
- CPU brand, cores, frequency, load, usage
- Memory usage, swap
- Disk space
- Battery / power status
- Thermal state & temperatures (`pmset`, `powermetrics`)
- Network RX/TX
- Top processes

## Requirements

- macOS 14+
- Node.js 18+
- Optional: `sudo` for `powermetrics` detailed temperatures in `--detailed` mode
