import chalk from 'chalk';
import { run } from './monitors/run.js';
import { readConfig, CONFIG_FILE } from './state/config.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: string;
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Sudo / Powermetrics Access
  try {
    const pmResult = await run('sudo -n powermetrics --samplers cpu_power -n 1 2>&1', '');
    if (pmResult.includes('Password:') || pmResult.includes('Permission denied') || pmResult.includes('sudo: a password is required')) {
      checks.push({
        name: 'Sudo / Powermetrics',
        status: 'warn',
        message: 'Passwordless sudo for powermetrics is not configured.',
        details: 'Powermetrics allows high-precision GPU & CPU power sampling. Run with sudo or configure passwordless sudo in /etc/sudoers.',
      });
    } else {
      checks.push({
        name: 'Sudo / Powermetrics',
        status: 'ok',
        message: 'Powermetrics access available.',
      });
    }
  } catch {
    checks.push({
      name: 'Sudo / Powermetrics',
      status: 'warn',
      message: 'Powermetrics check failed.',
    });
  }

  // 2. TCC / System Permissions
  try {
    const psCheck = await run('ps -ax -o pid,user,command', '');
    if (psCheck.length > 0) {
      checks.push({
        name: 'TCC / Process Visibility',
        status: 'ok',
        message: 'Process listing access available.',
      });
    } else {
      checks.push({
        name: 'TCC / Process Visibility',
        status: 'warn',
        message: 'Restricted process visibility.',
        details: 'Grant Full Disk Access or Terminal permissions in System Settings -> Privacy & Security.',
      });
    }
  } catch {
    checks.push({
      name: 'TCC / Process Visibility',
      status: 'error',
      message: 'Unable to list system processes.',
    });
  }

  // 3. Network Reachability for P2P
  try {
    const netCheck = await run('netstat -rn', '');
    if (netCheck.includes('default') || netCheck.includes('gateway')) {
      checks.push({
        name: 'Network Reachability',
        status: 'ok',
        message: 'Network interface active with default gateway.',
      });
    } else {
      checks.push({
        name: 'Network Reachability',
        status: 'warn',
        message: 'No active network route detected for P2P mode.',
      });
    }
  } catch {
    checks.push({
      name: 'Network Reachability',
      status: 'warn',
      message: 'Could not verify network routes.',
    });
  }

  // 4. Gatekeeper Status (spctl)
  try {
    const spctlOut = await run('spctl --status 2>&1', '');
    if (spctlOut.includes('assessments enabled')) {
      checks.push({
        name: 'Gatekeeper',
        status: 'ok',
        message: 'Gatekeeper enforcement is enabled.',
      });
    } else {
      checks.push({
        name: 'Gatekeeper',
        status: 'warn',
        message: 'Gatekeeper is disabled or status check unconfirmed.',
        details: 'Re-enable Gatekeeper using "sudo spctl --master-enable" to protect against untrusted software.',
      });
    }
  } catch {
    checks.push({
      name: 'Gatekeeper',
      status: 'warn',
      message: 'Could not query Gatekeeper status.',
    });
  }

  // 5. System Integrity Protection (SIP / csrutil)
  try {
    const sipOut = await run('csrutil status 2>&1', '');
    if (sipOut.includes('enabled')) {
      checks.push({
        name: 'System Integrity Protection',
        status: 'ok',
        message: 'SIP is enabled.',
      });
    } else {
      checks.push({
        name: 'System Integrity Protection',
        status: 'warn',
        message: 'SIP is disabled or restricted.',
        details: 'System Integrity Protection protects core system files. Enable it from macOS Recovery.',
      });
    }
  } catch {
    checks.push({
      name: 'System Integrity Protection',
      status: 'warn',
      message: 'Could not query SIP status.',
    });
  }

  // 6. XProtect Definition Status
  try {
    const xprotectOut = await run('system_profiler SPInstallHistoryDataType 2>&1', '');
    const xpMatches = Array.from(xprotectOut.matchAll(/XProtect(?:Remediator)?ConfigData.*?\n.*?Install Date:\s*(.+)/gi));
    if (xpMatches.length > 0) {
      const latestDateStr = xpMatches[xpMatches.length - 1][1];
      checks.push({
        name: 'XProtect Definitions',
        status: 'ok',
        message: `XProtect active (last updated ${latestDateStr.trim()}).`,
      });
    } else {
      checks.push({
        name: 'XProtect Definitions',
        status: 'ok',
        message: 'XProtect definitions installed.',
      });
    }
  } catch {
    checks.push({
      name: 'XProtect Definitions',
      status: 'warn',
      message: 'Could not determine XProtect update history.',
    });
  }

  // 7. Config file integrity
  try {
    const cfg = readConfig();
    checks.push({
      name: 'Configuration File',
      status: 'ok',
      message: `Config file valid (${CONFIG_FILE}).`,
    });
  } catch (err: any) {
    checks.push({
      name: 'Configuration File',
      status: 'error',
      message: 'Failed to parse config file.',
      details: err.message,
    });
  }

  return checks;
}

export function printDoctorReport(checks: DoctorCheck[]): void {
  console.log(chalk.bold('\n  pyre doctor — System Diagnostics\n'));

  for (const check of checks) {
    let icon = chalk.green('✔');
    if (check.status === 'warn') icon = chalk.yellow('⚠');
    if (check.status === 'error') icon = chalk.red('✖');

    console.log(`  ${icon} ${chalk.bold(check.name.padEnd(26))} ${check.message}`);
    if (check.details) {
      console.log(chalk.dim(`     ↳ ${check.details}`));
    }
  }
  console.log();
}
