import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

const PLIST_LABEL = 'com.pyre.web';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

export function installLaunchdAgent(port: number = 3000): void {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(process.argv[1]);

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>web</string>
        <string>--port</string>
        <string>${port}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.config', 'pyre', 'web.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.config', 'pyre', 'web.err')}</string>
</dict>
</plist>
`;

  try {
    const launchAgentsDir = path.dirname(PLIST_PATH);
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }

    fs.writeFileSync(PLIST_PATH, plistContent);
    try {
      execSync(`launchctl unload ${PLIST_PATH} 2>/dev/null`);
    } catch {
      // ignore if not previously loaded
    }
    execSync(`launchctl load ${PLIST_PATH}`);

    console.log(chalk.green(`✔ Installed and started launchd agent at ${PLIST_PATH}`));
    console.log(chalk.dim(`  Service label: ${PLIST_LABEL}`));
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to install launchd agent: ${err.message}`));
  }
}

export function uninstallLaunchdAgent(): void {
  try {
    if (fs.existsSync(PLIST_PATH)) {
      try {
        execSync(`launchctl unload ${PLIST_PATH} 2>/dev/null`);
      } catch {
        // ignore unload errors
      }
      fs.unlinkSync(PLIST_PATH);
      console.log(chalk.green(`✔ Uninstalled launchd agent ${PLIST_PATH}`));
    } else {
      console.log(chalk.yellow(`  No launchd agent found at ${PLIST_PATH}`));
    }
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to uninstall launchd agent: ${err.message}`));
  }
}
