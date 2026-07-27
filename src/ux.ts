export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

export function renderHeader(screenName: string): void {
  const width = Math.min(process.stdout.columns || 80, 80);
  const title = ` PYRE CLI - [${screenName}] `;
  const border = '='.repeat(width);
  console.log(border);
  console.log(title.padStart((width + title.length) / 2).padEnd(width));
  console.log(border + '\n');
}

export function renderCustomizationMenu(selectedIndex: number): void {
  const options = [
    'Theme Mode: Dark / Light',
    'Log Level: Verbose / Info / Error',
    'Update Interval: 1000ms',
    'Enable Telemetry: False',
    'Back to Main Menu'
  ];

  console.log(' Customization Options:');
  console.log(' ------------------------------------------');

  options.forEach((opt, idx) => {
    const isSelected = idx === (selectedIndex % options.length);
    const prefix = isSelected ? '> ' : '  ';
    const formattedOption = truncate(opt, 60);
    if (isSelected) {
      console.log(`\x1b[36m${prefix}${formattedOption}\x1b[0m`);
    } else {
      console.log(`${prefix}${formattedOption}`);
    }
  });

  console.log(' ------------------------------------------');
  console.log(' Use Up/Down arrows to navigate. Press ESC or Q to return.');
}

export function renderActivityMonitor(processes: any[]): void {
  console.log(' Active Processes Monitor:');
  console.log(' --------------------------------------------------');
  console.log('  PID     | COMMAND              | CPU %   | MEM % ');
  console.log(' --------------------------------------------------');

  if (!processes || processes.length === 0) {
    console.log('  No process data available or scanning processes...');
  } else {
    processes.slice(0, 15).forEach((proc) => {
      const pid = String(proc.pid).padEnd(7);
      const name = truncate(proc.name || 'unknown', 20).padEnd(20);
      const cpu = String(proc.cpu || '0.0').padEnd(7);
      const mem = String(proc.mem || '0.0').padEnd(7);
      console.log(`  ${pid} | ${name} | ${cpu} | ${mem}`);
    });
  }

  console.log(' --------------------------------------------------');
  console.log(' Press [Q] or [ESC] to return to Main Menu.');
}