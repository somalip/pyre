import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export interface XbarOptions {
  install?: boolean;
  yes?: boolean;
  dir?: string;
}

export function isSwiftBarInstalled(): boolean {
  if (process.platform !== 'darwin') return false;
  return (
    fs.existsSync('/Applications/SwiftBar.app') ||
    fs.existsSync(path.join(os.homedir(), 'Applications', 'SwiftBar.app'))
  );
}

export function isXbarInstalled(): boolean {
  if (process.platform !== 'darwin') return false;
  return (
    fs.existsSync('/Applications/xbar.app') ||
    fs.existsSync(path.join(os.homedir(), 'Applications', 'xbar.app'))
  );
}

export function isBrewAvailable(): boolean {
  try {
    execSync('brew --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function confirmPrompt(question: string, yes?: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      const a = ans.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

export async function generateXbarPlugin(opts: XbarOptions = {}): Promise<string> {
  const pyrePath = process.argv[1];
  const nodePath = process.execPath;

  const script = `#!/bin/bash
# <xbar.title>Pyre Monitor</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>somalip</xbar.author>
# <xbar.author.github>somalip</xbar.author.github>
# <xbar.desc>Cross-platform system monitoring powered by pyre.</xbar.desc>

# Run pyre to get a JSON snapshot
DATA=$("${nodePath}" "${pyrePath}" --once --json)

if [ -z "$DATA" ]; then
  echo "🔥 err"
  echo "---"
  echo "Could not fetch data"
  exit 1
fi

CPU=$(echo "$DATA" | grep -o '"usage": *[0-9.]*' | head -1 | awk '{print $2}')
MEM=$(echo "$DATA" | grep -o '"usagePercent": *[0-9.]*' | head -1 | awk '{print $2}')
TEMP=$(echo "$DATA" | grep -o '"temperature": *[0-9.]*' | head -1 | awk '{print $2}')

# Format to 1 decimal place
CPU=$(printf "%.1f" "$CPU")
MEM=$(printf "%.1f" "$MEM")
TEMP=$(printf "%.1f" "$TEMP")

echo "🔥 C:\${CPU}% M:\${MEM}% T:\${TEMP}°C | font=Menlo"
echo "---"
echo "Open Dashboard | bash='${nodePath}' param1='${pyrePath}' param2='live' terminal=true"
`;

  const filename = 'pyre-monitor.2s.sh';

  // 1. Explicit target directory passed by caller
  if (opts.dir) {
    const targetDir = path.resolve(opts.dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const destFile = path.join(targetDir, filename);
    fs.writeFileSync(destFile, script);
    try {
      fs.chmodSync(destFile, 0o755);
    } catch {}
    console.log(chalk.green(`\n  ✔ Installed menu bar plugin script directly to:`));
    console.log(chalk.bold.cyan(`    ${destFile}\n`));
    return destFile;
  }

  // 2. macOS handling with SwiftBar auto-installation
  if (process.platform === 'darwin') {
    let hasSwiftBar = isSwiftBarInstalled();
    const hasXbar = isXbarInstalled();

    if (!hasSwiftBar && !hasXbar) {
      if (isBrewAvailable()) {
        console.log(chalk.bold.yellow(`\n  💡 SwiftBar is required to display Pyre live stats in your macOS menu bar.`));
        const proceed = await confirmPrompt(
          chalk.cyan(`  Would you like Pyre to install SwiftBar via Homebrew? [y/N]: `),
          opts.yes
        );

        if (proceed) {
          console.log(chalk.cyan(`\n  ▶ Installing SwiftBar via Homebrew (brew install --cask swiftbar)...`));
          try {
            execSync('brew install --cask swiftbar', { stdio: 'inherit' });
            hasSwiftBar = isSwiftBarInstalled();
            if (hasSwiftBar) {
              console.log(chalk.green(`  ✔ SwiftBar installed successfully!`));
            }
          } catch (err: any) {
            console.error(chalk.red(`  ✖ Failed to install SwiftBar: ${err.message}`));
          }
        }
      }
    }

    // If SwiftBar is available (either pre-existing or freshly installed)
    if (hasSwiftBar) {
      const swiftBarDir = path.join(os.homedir(), 'Library', 'Application Support', 'SwiftBar', 'plugins');
      if (!fs.existsSync(swiftBarDir)) {
        fs.mkdirSync(swiftBarDir, { recursive: true });
      }
      const destFile = path.join(swiftBarDir, filename);
      fs.writeFileSync(destFile, script);
      try {
        fs.chmodSync(destFile, 0o755);
      } catch {}

      // Configure default SwiftBar plugin directory so it doesn't show an initial folder picker modal
      try {
        execSync(`defaults write com.ameba.SwiftBar PluginDirectory "${swiftBarDir}"`, { stdio: 'ignore' });
      } catch {}

      // Launch SwiftBar if not currently running
      let isRunning = false;
      try {
        execSync('pgrep -il swiftbar', { stdio: 'ignore' });
        isRunning = true;
      } catch {}

      if (!isRunning) {
        try {
          execSync('open -a SwiftBar', { stdio: 'ignore' });
        } catch {}
      }

      console.log(chalk.bold.green(`\n  🔥 Pyre is now active in your macOS menu bar!`));
      console.log(chalk.dim(`  Look at the top right of your screen for live CPU, RAM, and temperature.`));
      console.log(chalk.dim(`  Plugin location: ${destFile}\n`));
      return destFile;
    }

    // If xbar is available
    if (hasXbar) {
      const xbarDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');
      if (!fs.existsSync(xbarDir)) {
        fs.mkdirSync(xbarDir, { recursive: true });
      }
      const destFile = path.join(xbarDir, filename);
      fs.writeFileSync(destFile, script);
      try {
        fs.chmodSync(destFile, 0o755);
      } catch {}

      try {
        execSync('open -a xbar', { stdio: 'ignore' });
      } catch {}

      console.log(chalk.bold.green(`\n  🔥 Pyre is now active in your macOS menu bar via xbar!`));
      console.log(chalk.dim(`  Plugin location: ${destFile}\n`));
      return destFile;
    }

    // Neither app is installed and user declined or brew wasn't available
    const outPath = path.join(process.cwd(), filename);
    fs.writeFileSync(outPath, script);
    try {
      fs.chmodSync(outPath, 0o755);
    } catch {}

    const swiftBarDir = path.join(os.homedir(), 'Library', 'Application Support', 'SwiftBar', 'plugins');
    console.log(chalk.green(`\n  ✔ Generated menu bar plugin script at ${outPath}\n`));
    console.log(chalk.bold(`  To view this in your menu bar, install SwiftBar or xbar:`));
    console.log(chalk.cyan(`    brew install --cask swiftbar`));
    console.log(chalk.dim(`    mkdir -p "${swiftBarDir}" && mv "${filename}" "${swiftBarDir}/"`));
    console.log(chalk.dim(`    open -a SwiftBar\n`));
    return outPath;
  }

  // 3. Linux / Argos handling
  if (process.platform === 'linux') {
    const argosDir = path.join(os.homedir(), '.config', 'argos');
    if (opts.install) {
      if (!fs.existsSync(argosDir)) {
        fs.mkdirSync(argosDir, { recursive: true });
      }
      const destFile = path.join(argosDir, filename);
      fs.writeFileSync(destFile, script);
      try {
        fs.chmodSync(destFile, 0o755);
      } catch {}
      console.log(chalk.green(`\n  ✔ Installed menu bar plugin script to ${destFile}\n`));
      return destFile;
    }

    const outPath = path.join(process.cwd(), filename);
    fs.writeFileSync(outPath, script);
    try {
      fs.chmodSync(outPath, 0o755);
    } catch {}
    console.log(chalk.green(`\n  ✔ Generated menu bar plugin script at ${outPath}\n`));
    console.log(`  To install in Argos (GNOME Shell) on Linux:`);
    console.log(chalk.cyan(`    mkdir -p "${argosDir}" && mv "${filename}" "${argosDir}/"\n`));
    return outPath;
  }

  // Fallback for Windows / other
  const outPath = path.join(process.cwd(), filename);
  fs.writeFileSync(outPath, script);
  try {
    fs.chmodSync(outPath, 0o755);
  } catch {}
  console.log(chalk.green(`\n  ✔ Generated menu bar plugin script at ${outPath}\n`));
  console.log(chalk.dim(`  Compatible with BitBar, xbar, and Argos shell plugins.\n`));
  return outPath;
}
