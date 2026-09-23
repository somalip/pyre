import fs from 'node:fs';
import os from 'node:os';
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
  const platform = process.platform;
  if (platform === 'linux') return runLinuxDoctor();
  if (platform === 'win32') return runWindowsDoctor();
  return runMacDoctor();
}

async function runMacDoctor(): Promise<DoctorCheck[]> {
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
  checks.push(checkConfigIntegrity());

  return checks;
}

async function runLinuxDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Process Visibility
  try {
    const psCheck = await run('ps -eo pid,user,comm', '');
    if (psCheck.length > 0) {
      checks.push({
        name: 'Process Visibility',
        status: 'ok',
        message: 'Full process table access available.',
      });
    } else {
      checks.push({
        name: 'Process Visibility',
        status: 'warn',
        message: 'Restricted process table access.',
      });
    }
  } catch {
    checks.push({
      name: 'Process Visibility',
      status: 'error',
      message: 'Unable to query process list.',
    });
  }

  // 2. /proc and /sys Telemetry Access
  try {
    const statExists = fs.existsSync('/proc/stat');
    const memExists = fs.existsSync('/proc/meminfo');
    if (statExists && memExists) {
      checks.push({
        name: 'Kernel Telemetry (/proc)',
        status: 'ok',
        message: 'Kernel telemetry interfaces readable.',
      });
    } else {
      checks.push({
        name: 'Kernel Telemetry (/proc)',
        status: 'error',
        message: 'Core pseudo-filesystems (/proc) unavailable or restricted.',
      });
    }
  } catch {
    checks.push({
      name: 'Kernel Telemetry (/proc)',
      status: 'warn',
      message: 'Could not check /proc readability.',
    });
  }

  // 3. Thermal & Hardware Sensors
  try {
    const thermZones = fs.existsSync('/sys/class/thermal');
    const hwmon = fs.existsSync('/sys/class/hwmon');
    if (thermZones || hwmon) {
      checks.push({
        name: 'Hardware Sensors (/sys)',
        status: 'ok',
        message: 'Thermal and hardware monitoring sensors detected.',
      });
    } else {
      checks.push({
        name: 'Hardware Sensors (/sys)',
        status: 'warn',
        message: 'No hardware sensor paths detected in /sys/class.',
      });
    }
  } catch {
    checks.push({
      name: 'Hardware Sensors (/sys)',
      status: 'warn',
      message: 'Unable to query sensor interfaces.',
    });
  }

  // 4. Network Reachability
  try {
    const netCheck = await run('ip route 2>/dev/null || route -n 2>/dev/null', '');
    if (netCheck.includes('default') || netCheck.includes('0.0.0.0')) {
      checks.push({
        name: 'Network Reachability',
        status: 'ok',
        message: 'Active default route detected.',
      });
    } else {
      checks.push({
        name: 'Network Reachability',
        status: 'warn',
        message: 'No default network gateway detected.',
      });
    }
  } catch {
    checks.push({
      name: 'Network Reachability',
      status: 'warn',
      message: 'Could not verify network routes.',
    });
  }

  // 5. Systemd User Service Capability
  try {
    const sysctlRes = await run('systemctl --user status 2>&1', '');
    if (!sysctlRes.includes('Failed to connect to bus') && !sysctlRes.includes('not found')) {
      checks.push({
        name: 'Systemd User Daemon',
        status: 'ok',
        message: 'Systemd user session active (ready for pyre --install).',
      });
    } else {
      checks.push({
        name: 'Systemd User Daemon',
        status: 'warn',
        message: 'Systemd user session not available.',
        details: 'Background services via pyre --install require an active user systemd session.',
      });
    }
  } catch {
    checks.push({
      name: 'Systemd User Daemon',
      status: 'warn',
      message: 'Systemd check skipped.',
    });
  }

  // 6. Config file integrity
  checks.push(checkConfigIntegrity());

  return checks;
}

async function runWindowsDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Process Visibility
  try {
    const psCheck = await run('tasklist /nh 2>nul', '');
    if (psCheck.length > 0) {
      checks.push({
        name: 'Process Visibility',
        status: 'ok',
        message: 'Windows process table access available.',
      });
    } else {
      checks.push({
        name: 'Process Visibility',
        status: 'warn',
        message: 'Tasklist query returned no output.',
      });
    }
  } catch {
    checks.push({
      name: 'Process Visibility',
      status: 'error',
      message: 'Unable to query Windows tasklist.',
    });
  }

  // 2. PowerShell / WMI Interface
  try {
    const wmiCheck = await run('wmic os get Caption 2>nul || powershell -Command "(Get-CimInstance Win32_OperatingSystem).Caption"', '');
    if (wmiCheck.toLowerCase().includes('windows')) {
      checks.push({
        name: 'WMI / CIM Subsystem',
        status: 'ok',
        message: 'WMI/CIM management queries responsive.',
      });
    } else {
      checks.push({
        name: 'WMI / CIM Subsystem',
        status: 'warn',
        message: 'WMI/CIM query did not return expected response.',
        details: 'Some hardware metrics (disks, thermal) rely on WMI or PowerShell CIM.',
      });
    }
  } catch {
    checks.push({
      name: 'WMI / CIM Subsystem',
      status: 'warn',
      message: 'Could not execute WMI query.',
    });
  }

  // 3. Network Reachability
  try {
    const netCheck = await run('netstat -rn 2>nul', '');
    if (netCheck.includes('0.0.0.0')) {
      checks.push({
        name: 'Network Reachability',
        status: 'ok',
        message: 'Active default IPv4 gateway detected.',
      });
    } else {
      checks.push({
        name: 'Network Reachability',
        status: 'warn',
        message: 'No default route detected in routing table.',
      });
    }
  } catch {
    checks.push({
      name: 'Network Reachability',
      status: 'warn',
      message: 'Could not verify Windows network routes.',
    });
  }

  // 4. Config file integrity
  checks.push(checkConfigIntegrity());

  return checks;
}

function checkConfigIntegrity(): DoctorCheck {
  try {
    readConfig();
    return {
      name: 'Configuration File',
      status: 'ok',
      message: `Config file valid (${CONFIG_FILE}).`,
    };
  } catch (err: any) {
    return {
      name: 'Configuration File',
      status: 'error',
      message: 'Failed to parse config file.',
      details: err.message,
    };
  }
}

export function printDoctorReport(checks: DoctorCheck[]): void {
  const osLabel = process.platform === 'darwin' ? 'macOS' : (process.platform === 'win32' ? 'Windows' : 'Linux');
  console.log(chalk.bold(`\n  pyre doctor — System Diagnostics (${osLabel})\n`));

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
