/**
 * pyre smart — S.M.A.R.T. disk health inspector.
 *
 * Uses smartctl (from smartmontools) for detailed SMART data across macOS, Linux, and Windows.
 * Falls back to native platform inspectors when smartctl is not installed:
 *  - macOS: diskutil
 *  - Windows: Get-PhysicalDisk & Get-StorageReliabilityCounter & Win32_DiskDrive
 *  - Linux: lsblk & hdparm
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { runPowerShell } from './monitors/run.js';

const execFileAsync = promisify(execFile);

export interface DiskInfo {
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

export function parseWindowsPhysicalDiskCsv(csvRaw: string): DiskInfo[] {
  const lines = csvRaw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const disks: DiskInfo[] = [];

  for (const line of lines.slice(1)) {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });

    const deviceId = row.DeviceId || row.DeviceID || '0';
    const friendlyName = row.FriendlyName || row.Model || 'Physical Disk';
    const serialNumber = row.SerialNumber || '';
    const mediaType = row.MediaType || row.InterfaceType || '';
    const healthStatus = (row.HealthStatus || row.Status || '').toUpperCase();
    const sizeBytes = parseFloat(row.Size) || 0;

    let health: DiskInfo['health'] = 'Unknown';
    if (healthStatus.includes('HEALTHY') || healthStatus.includes('OK') || healthStatus.includes('PASSED')) {
      health = 'PASSED';
    } else if (healthStatus.includes('UNHEALTHY') || healthStatus.includes('ERROR') || healthStatus.includes('FAILED')) {
      health = 'FAILED';
    }

    const capacity = sizeBytes > 0
      ? sizeBytes >= 1e12 ? `${(sizeBytes / 1e12).toFixed(1)} TB`
        : sizeBytes >= 1e9 ? `${(sizeBytes / 1e9).toFixed(0)} GB`
        : `${(sizeBytes / 1e6).toFixed(0)} MB`
      : undefined;

    disks.push({
      device: `\\\\.\\PhysicalDrive${deviceId}`,
      model: friendlyName,
      serialNumber,
      health,
      protocol: mediaType,
      capacity,
    });
  }

  return disks;
}

export function parseWindowsReliabilityCsv(csvRaw: string): Partial<DiskInfo> {
  const lines = csvRaw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return {};

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
  const row: Record<string, string> = {};
  headers.forEach((h, i) => { row[h] = values[i] || ''; });

  const temp = parseFloat(row.Temperature);
  const wear = parseFloat(row.Wear);
  const poh = parseFloat(row.PowerOnHours);
  const readErrors = parseFloat(row.ReadErrorsTotal);
  const writeErrors = parseFloat(row.WriteErrorsTotal);

  return {
    tempC: Number.isFinite(temp) && temp > 0 && temp < 120 ? temp : undefined,
    percentUsed: Number.isFinite(wear) && wear >= 0 && wear <= 100 ? wear : undefined,
    powerOnHours: Number.isFinite(poh) && poh >= 0 ? poh : undefined,
    reallocatedSectors: (Number.isFinite(readErrors) ? readErrors : 0) + (Number.isFinite(writeErrors) ? writeErrors : 0),
  };
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

  // 3. Windows native query
  if (process.platform === 'win32') {
    try {
      const raw = await runPowerShell(
        `Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DeviceId`,
        ''
      );
      const ids = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        return ids.map(id => `\\\\.\\PhysicalDrive${id}`);
      }
    } catch {}
    return ['\\\\.\\PhysicalDrive0'];
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

async function collectWindowsDiskFallback(device: string): Promise<DiskInfo | null> {
  const match = device.match(/PhysicalDrive(\d+)/i);
  const diskNumber = match ? match[1] : '0';

  try {
    const rawDisk = await runPowerShell(
      `Get-PhysicalDisk -DeviceId '${diskNumber}' -ErrorAction SilentlyContinue | Select-Object DeviceId, FriendlyName, SerialNumber, MediaType, HealthStatus, Size | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const parsed = parseWindowsPhysicalDiskCsv(rawDisk);
    if (parsed.length > 0) {
      const info = parsed[0];
      info.device = device;

      // Query storage reliability counters for wear, temp, and power on hours
      try {
        const rawReliability = await runPowerShell(
          `Get-StorageReliabilityCounter -Disk (Get-Disk -Number ${diskNumber} -ErrorAction SilentlyContinue) -ErrorAction SilentlyContinue | Select-Object Temperature, Wear, PowerOnHours, ReadErrorsTotal, WriteErrorsTotal | ConvertTo-Csv -NoTypeInformation`,
          ''
        );
        const rel = parseWindowsReliabilityCsv(rawReliability);
        if (rel.tempC !== undefined) info.tempC = rel.tempC;
        if (rel.percentUsed !== undefined) info.percentUsed = rel.percentUsed;
        if (rel.powerOnHours !== undefined) info.powerOnHours = rel.powerOnHours;
        if (rel.reallocatedSectors !== undefined) info.reallocatedSectors = rel.reallocatedSectors;
      } catch {}

      return info;
    }
  } catch {}

  // Fallback to Win32_DiskDrive
  try {
    const rawWmi = await runPowerShell(
      `Get-CimInstance Win32_DiskDrive -Filter "Index = ${diskNumber}" -ErrorAction SilentlyContinue | Select-Object Model, SerialNumber, Status, Size | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const lines = rawWmi.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      const values = lines[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      const sizeBytes = parseFloat(values[3]) || 0;
      return {
        device,
        model: values[0] || 'Physical Disk',
        serialNumber: values[1] || '',
        health: values[2]?.toUpperCase().includes('OK') ? 'PASSED' : 'Unknown',
        capacity: sizeBytes >= 1e12 ? `${(sizeBytes / 1e12).toFixed(1)} TB` : `${(sizeBytes / 1e9).toFixed(0)} GB`,
      };
    }
  } catch {}

  return null;
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
    console.log(chalk.yellow('  ⚠ smartctl not found. Showing native storage health metrics.'));
    const installHint = process.platform === 'win32'
      ? 'winget install smartmontools'
      : (process.platform === 'linux' ? 'sudo apt install smartmontools' : 'brew install smartmontools');
    console.log(chalk.dim('  For full SMART data: ') + chalk.cyan(installHint) + '\n');
  }

  const devices = await getPhysicalDisks();
  if (devices.length === 0) {
    console.log(chalk.yellow('  No physical disks found.\n'));
    return;
  }

  for (const device of devices) {
    let info: DiskInfo | null = null;
    if (hasSmartctl) info = await collectSmartctlDisk(device);
    if (!info && process.platform === 'win32') info = await collectWindowsDiskFallback(device);
    if (!info && process.platform === 'darwin') info = await collectDiskutilFallback(device);
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
    console.log(chalk.dim('  Install smartmontools for complete SMART attribute dump.\n'));
  }
}
