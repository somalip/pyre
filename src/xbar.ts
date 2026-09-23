import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

export function generateXbarPlugin() {
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
  const outPath = path.join(process.cwd(), filename);

  fs.writeFileSync(outPath, script);
  try {
    fs.chmodSync(outPath, 0o755);
  } catch {
    // ignore on non-POSIX filesystems
  }

  console.log(chalk.green(`Generated menu bar plugin script at ${outPath}`));

  if (process.platform === 'darwin') {
    const pluginDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');
    console.log(`To install in xbar or SwiftBar on macOS:`);
    console.log(chalk.cyan(`  mv ${filename} "${pluginDir}/"`));
  } else if (process.platform === 'linux') {
    const argosDir = path.join(os.homedir(), '.config', 'argos');
    console.log(`To install in Argos (GNOME Shell) on Linux:`);
    console.log(chalk.cyan(`  mkdir -p "${argosDir}" && mv ${filename} "${argosDir}/"`));
  } else {
    console.log(chalk.dim(`Compatible with BitBar, xbar, and Argos shell plugins.`));
  }
}
