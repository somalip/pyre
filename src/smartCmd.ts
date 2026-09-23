/**
 * pyre smart — S.M.A.R.T. disk health inspector.
 *
 * Uses smartctl (from smartmontools, via brew install smartmontools)
 * for detailed SMART data. Falls back to diskutil info when
 * smartctl is not installed.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);

interface DiskInfo {
  device: string;
  model: string;
  serialNumber: string;
  health: 'PASSED' | 'FAILED' | 'Unknown';
  tempC?: number;
  powerOnHours?: number;
  reallocatedSectors?: number;
  percentUsed?: number;
  bytesRead?: number;
  bytesWritten?: number;
  protocol?: string;
  capacity?: string;
}

async function runCmd(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function getPhysicalDisks(): Promise<string[]> {
  // 1. First try smartctl --scan --json on all platforms
  const scanRaw = await runCmd('smartctl', ['--scan', '--json']);
  if (scanRaw) {
    try {
      const parsed = JSON.parse(scanRaw);
      if (Array.isArray(parsed.devices) && parsed.devices.length > 0) {
        return parsed.devices.map((d: any) => d.name).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }

  // 2. Linux fallback: lsblk
  if (process.platform === 'linux') {
    const lsblk = await runCmd('lsblk', ['-dpno', 'NAME']);
    if (lsblk) {
      const disks = lsblk.split('\n').map(s => s.trim()).filter(d => /^\/dev\/(sd[a-z]|nvme\d+n\d+|vd[a-z])/.test(d));
      if (disks.length > 0) return disks;
    }
    return ['/dev/sda'];
  }

  // 3. Windows fallback
  if (process.platform === 'win32') {
    return ['/dev/sda', '/dev/csmi0,0'];
  }

  // 4. macOS fallback: diskutil
  const raw = await runCmd('diskutil', ['list', '-plist']);
  if (!raw) return ['/dev/disk0'];
  const matches = raw.match(/\/dev\/disk\d+(?!s)/g) ?? [];
  return [...new Set(matches)].filter(d => /^\/dev\/disk\d+$/.test(d));
}

async function collectSmartctlDisk(device: string): Promise<DiskInfo | null> {
  const raw = await runCmd('smartctl', ['-a', '--json', device], 6000);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const model = j.model_name ?? j.device?.name ?? 'Unknown';
    const serial = j.serial_number ?? '';
    const protocol = j.device?.protocol ?? '';
    const passed = j.smart_status?.passed;
    const health: DiskInfo['health'] = passed === true ? 'PASSED' : passed === false ? 'FAILED' : 'Unknown';

    let tempC: number | undefined;
    if (j.temperature?.current !== undefined) tempC = j.temperature.current;

    const poh = j.power_on_time?.hours;

    let reallocated: number | undefined;
    if (Array.isArray(j.ata_smart_attributes?.table)) {
      const attr = j.ata_smart_attributes.table.find((a: any) => a.id === 5);
      if (attr) reallocated = attr.raw?.value ?? 0;
    }

    let percentUsed: number | undefined;
    if (j.nvme_smart_health_information_log?.percentage_used !== undefined) {
      percentUsed = j.nvme_smart_health_information_log.percentage_used;
    }

    let bytesRead: number | undefined;
    let bytesWritten: number | undefined;
    if (j.nvme_smart_health_information_log) {
      const unitsRead = j.nvme_smart_health_information_log.data_units_read;
      const unitsWritten = j.nvme_smart_health_information_log.data_units_written;
      if (unitsRead !== undefined) bytesRead = unitsRead * 512000;
      if (unitsWritten !== undefined) bytesWritten = unitsWritten * 512000;
    }

    const userCap = j.user_capacity?.bytes;
    const capacity = userCap !== undefined
      ? userCap >= 1e12 ? `${(userCap / 1e12).toFixed(1)} TB`
        : userCap >= 1e9 ? `${(userCap / 1e9).toFixed(0)} GB`
        : `${(userCap / 1e6).toFixed(0)} MB`
      : undefined;

    return { device, model, serialNumber: serial, health, tempC, powerOnHours: poh,
             reallocatedSectors: reallocated, percentUsed, bytesRead, bytesWritten, protocol, capacity };
  } catch {
    return null;
  }
}

async function collectDiskutilFallback(device: string): Promise<DiskInfo | null> {
  const raw = await runCmd('diskutil', ['info', device]);
  if (!raw) return null;
  const nameMatch = raw.match(/(?:Device \/ Media Name|Volume Name|Media Name):\s*(.+)/i);
  const sizeMatch = raw.match(/Disk Size:\s*(.+?\([^)]+\))/i);
  return {
    device,
    model: nameMatch?.[1]?.trim() || 'Unknown',
    serialNumber: '',
    health: 'Unknown',
    capacity: sizeMatch?.[1]?.trim(),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e15) return `${(bytes / 1e15).toFixed(1)} PB`;
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function healthColor(h: DiskInfo['health']): string {
  if (h === 'PASSED') return chalk.green(h);
  if (h === 'FAILED') return chalk.red.bold(h);
  return chalk.dim(h);
}

export async function runSmartCommand(): Promise<void> {
  console.log(chalk.bold('\n  🔥 pyre — S.M.A.R.T. Disk Health\n'));

  const smartctlVersion = await runCmd('smartctl', ['--version'], 2000);
  const hasSmartctl = smartctlVersion.includes('smartmontools');

  if (!hasSmartctl) {
    console.log(chalk.yellow('  ⚠ smartctl not found. Showing basic disk info.'));
    console.log(chalk.dim('  For full SMART data: ') + chalk.cyan('brew install smartmontools') + '\n');
  }

  const devices = await getPhysicalDisks();
  if (devices.length === 0) {
    console.log(chalk.yellow('  No physical disks found.\n'));
    return;
  }

  for (const device of devices) {
    let info: DiskInfo | null = null;
    if (hasSmartctl) info = await collectSmartctlDisk(device);
    if (!info) info = await collectDiskutilFallback(device);
    if (!info) continue;

    console.log(chalk.bold(`  ${info.device}`));
    console.log(`    Model:            ${info.model}`);
    if (info.serialNumber) console.log(`    Serial:           ${chalk.dim(info.serialNumber)}`);
    if (info.protocol) console.log(`    Protocol:         ${info.protocol}`);
    if (info.capacity) console.log(`    Capacity:         ${info.capacity}`);
    console.log(`    Health:           ${healthColor(info.health)}`);
    if (info.tempC !== undefined) {
      const tc = info.tempC >= 60 ? chalk.red : info.tempC >= 45 ? chalk.yellow : chalk.green;
      console.log(`    Temperature:      ${tc(`${info.tempC}°C`)}`);
    }
    if (info.powerOnHours !== undefined) {
      const days = Math.floor(info.powerOnHours / 24);
      console.log(`    Power-On Hours:   ${info.powerOnHours.toLocaleString()} h (${days} days)`);
    }
    if (info.reallocatedSectors !== undefined) {
      const sc = info.reallocatedSectors > 0 ? chalk.yellow : chalk.green;
      console.log(`    Reallocated Secs: ${sc(info.reallocatedSectors.toString())}`);
    }
    if (info.percentUsed !== undefined) {
      const wc = info.percentUsed >= 90 ? chalk.red : info.percentUsed >= 50 ? chalk.yellow : chalk.green;
      console.log(`    Wear Level:       ${wc(`${info.percentUsed}% used`)}`);
    }
    if (info.bytesRead !== undefined) console.log(`    Data Read:        ${formatBytes(info.bytesRead)}`);
    if (info.bytesWritten !== undefined) console.log(`    Data Written:     ${formatBytes(info.bytesWritten)}`);
    console.log();
  }

  if (!hasSmartctl) {
    console.log(chalk.dim('  Install smartmontools for full SMART attributes.\n'));
  }
}
