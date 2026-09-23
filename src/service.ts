import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

const SERVICE_LABEL = 'com.pyre.web';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
const SYSTEMD_USER_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_USER_DIR, 'pyre-web.service');
const TASK_NAME = 'PyreWeb';

export function installService(port: number = 3000): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    installLaunchd(port);
  } else if (platform === 'linux') {
    installSystemd(port);
  } else if (platform === 'win32') {
    installWindowsTask(port);
  } else {
    console.log(chalk.yellow(`⚠ Background service installation not supported on ${platform}.`));
  }
}

export function uninstallService(): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    uninstallLaunchd();
  } else if (platform === 'linux') {
    uninstallSystemd();
  } else if (platform === 'win32') {
    uninstallWindowsTask();
  } else {
    console.log(chalk.yellow(`⚠ Background service uninstallation not supported on ${platform}.`));
  }
}

// Backward-compatible exports for existing callers
export const installLaunchdAgent = installService;
export const uninstallLaunchdAgent = uninstallService;

function installLaunchd(port: number): void {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(process.argv[1]);

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
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
      // ignore
    }
    execSync(`launchctl load ${PLIST_PATH}`);

    console.log(chalk.green(`✔ Installed and started launchd agent at ${PLIST_PATH}`));
    console.log(chalk.dim(`  Service label: ${SERVICE_LABEL}`));
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to install launchd agent: ${err.message}`));
  }
}

function uninstallLaunchd(): void {
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

function installSystemd(port: number): void {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(process.argv[1]);
  const logDir = path.join(os.homedir(), '.config', 'pyre');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(SYSTEMD_USER_DIR)) fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });

  const unitContent = `[Unit]
Description=Pyre System Monitor Web Service
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} "${scriptPath}" web --port ${port}
Restart=always
RestartSec=5
StandardOutput=append:${path.join(logDir, 'web.log')}
StandardError=append:${path.join(logDir, 'web.err')}

[Install]
WantedBy=default.target
`;

  try {
    fs.writeFileSync(SYSTEMD_UNIT_PATH, unitContent);
    try {
      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable --now pyre-web.service');
    } catch (cmdErr: any) {
      console.log(chalk.yellow(`  Unit file written to ${SYSTEMD_UNIT_PATH}, but could not auto-enable: ${cmdErr.message}`));
      console.log(chalk.dim('  You can manually enable it using: systemctl --user enable --now pyre-web.service'));
      return;
    }
    console.log(chalk.green(`✔ Installed and started systemd user service at ${SYSTEMD_UNIT_PATH}`));
    console.log(chalk.dim('  Service name: pyre-web.service'));
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to install systemd user service: ${err.message}`));
  }
}

function uninstallSystemd(): void {
  try {
    if (fs.existsSync(SYSTEMD_UNIT_PATH)) {
      try {
        execSync('systemctl --user disable --now pyre-web.service 2>/dev/null');
      } catch {
        // ignore
      }
      fs.unlinkSync(SYSTEMD_UNIT_PATH);
      try {
        execSync('systemctl --user daemon-reload 2>/dev/null');
      } catch {
        // ignore
      }
      console.log(chalk.green(`✔ Uninstalled systemd user service ${SYSTEMD_UNIT_PATH}`));
    } else {
      console.log(chalk.yellow(`  No systemd service found at ${SYSTEMD_UNIT_PATH}`));
    }
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to uninstall systemd service: ${err.message}`));
  }
}

function installWindowsTask(port: number): void {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(process.argv[1]);
  try {
    const cmd = `schtasks /create /tn "${TASK_NAME}" /tr "\\"${nodePath}\\" \\"${scriptPath}\\" web --port ${port}" /sc onlogon /f`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(chalk.green(`✔ Installed Windows scheduled task '${TASK_NAME}' (runs on logon)`));
  } catch (err: any) {
    console.log(chalk.red(`✖ Failed to register Windows scheduled task: ${err.message}`));
  }
}

function uninstallWindowsTask(): void {
  try {
    const cmd = `schtasks /delete /tn "${TASK_NAME}" /f`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(chalk.green(`✔ Uninstalled Windows scheduled task '${TASK_NAME}'`));
  } catch (err: any) {
    console.log(chalk.yellow(`  No scheduled task '${TASK_NAME}' found or deletion failed: ${err.message}`));
  }
}
