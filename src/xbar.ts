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
# <xbar.desc>Mac system monitoring powered by pyre.</xbar.desc>

# Run pyre to get a JSON snapshot
# We use node directly to avoid env issues in xbar
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

  const pluginDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');
  const filename = 'pyre-monitor.2s.sh';
  const outPath = path.join(process.cwd(), filename);
  
  fs.writeFileSync(outPath, script);
  fs.chmodSync(outPath, '755');
  
  console.log(chalk.green(`Generated xbar plugin script at ${outPath}`));
  console.log(`To install, move it to your xbar plugins directory:`);
  console.log(chalk.cyan(`  mv ${filename} "${pluginDir}/"`));
  console.log(`Then refresh xbar.`);
}
