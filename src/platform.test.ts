import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Linux Telemetry Parsers', () => {
  it('should parse Linux memory info structure correctly', async () => {
    const { collectLinuxMemory } = await import('./monitors/platform/linux.js');
    const mem = await collectLinuxMemory();
    assert.ok(typeof mem.total === 'number');
    assert.ok(typeof mem.used === 'number');
    assert.ok(typeof mem.free === 'number');
    assert.ok(typeof mem.usagePercent === 'number');
    assert.ok(mem.pageSize === 4096);
  });

  it('should collect Linux system info', async () => {
    const { collectLinuxSystem } = await import('./monitors/platform/linux.js');
    const sys = await collectLinuxSystem();
    assert.ok(typeof sys.hostname === 'string');
    assert.ok(typeof sys.os === 'string');
    assert.ok(typeof sys.uptime === 'string');
  });

  it('should collect Linux disk structure', async () => {
    const { collectLinuxDisk } = await import('./monitors/platform/linux.js');
    const disks = await collectLinuxDisk();
    assert.ok(Array.isArray(disks));
    assert.ok(disks.length > 0);
    assert.ok(typeof disks[0].filesystem === 'string');
    assert.ok(typeof disks[0].mountpoint === 'string');
  });

  it('should collect Linux thermal structure gracefully', async () => {
    const { collectLinuxThermal } = await import('./monitors/platform/linux.js');
    const thermal = await collectLinuxThermal();
    assert.ok(typeof thermal.state === 'string');
    assert.ok(typeof thermal.pressureLevel === 'number');
  });
});

describe('Windows Telemetry Parsers', () => {
  it('should collect Windows system info with Windows OS mapping', async () => {
    const { collectWindowsSystem } = await import('./monitors/platform/windows.js');
    const sys = await collectWindowsSystem();
    assert.ok(typeof sys.hostname === 'string');
    assert.ok(sys.os.startsWith('Windows'));
    assert.ok(typeof sys.uptime === 'string');
  });

  it('should collect Windows memory structure', async () => {
    const { collectWindowsMemory } = await import('./monitors/platform/windows.js');
    const mem = await collectWindowsMemory();
    assert.ok(typeof mem.total === 'number');
    assert.ok(typeof mem.used === 'number');
    assert.ok(typeof mem.free === 'number');
    assert.ok(typeof mem.usagePercent === 'number');
    assert.ok(mem.pageSize === 4096);
  });

  it('should collect Windows CPU structure with simulated load average', async () => {
    const { collectWindowsCpu } = await import('./monitors/platform/windows.js');
    const cpuRef = { current: null };
    const cpu = await collectWindowsCpu(cpuRef);
    assert.ok(typeof cpu.brand === 'string');
    assert.ok(cpu.cores >= 1);
    assert.ok(Array.isArray(cpu.loadAvg));
    assert.strictEqual(cpu.loadAvg.length, 3);
  });

  it('should return Windows disk fallback structure', async () => {
    const { collectWindowsDisk } = await import('./monitors/platform/windows.js');
    const disks = await collectWindowsDisk();
    assert.ok(Array.isArray(disks));
    assert.ok(disks.length > 0);
    assert.ok(disks[0].mountpoint.includes(':'));
  });

  it('should collect Windows thermal structure with pressure level', async () => {
    const { collectWindowsThermal } = await import('./monitors/platform/windows.js');
    const thermal = await collectWindowsThermal();
    assert.ok(typeof thermal.state === 'string');
    assert.ok([0, 1, 2, 3].includes(thermal.pressureLevel));
  });
});

describe('Intel, AMD & NVIDIA Hardware Telemetry', () => {
  it('should parse NVIDIA GPU telemetry from nvidia-smi correctly', async () => {
    const { parseNvidiaSmiOutput } = await import('./monitors/platform/windows.js');
    const sampleCsv = `NVIDIA GeForce RTX 4090, 24564, 42, 58, 215.4\n`;
    const gpu = parseNvidiaSmiOutput(sampleCsv);
    assert.ok(gpu !== null);
    assert.strictEqual(gpu.model, 'NVIDIA GeForce RTX 4090');
    assert.strictEqual(gpu.memory, 24564 * 1024 * 1024);
    assert.strictEqual(gpu.utilization, 42);
    assert.strictEqual(gpu.temperature, 58);
    assert.strictEqual(gpu.powerDraw, 215.4);
  });

  it('should parse and prioritize AMD and Intel GPUs over integrated adapters', async () => {
    const { parseWindowsVideoControllers, prioritizeGpuControllers } = await import('./monitors/platform/windows.js');
    const sampleCsv = `"Name","AdapterRAM","DriverVersion","VideoProcessor","PNPDeviceID"
"AMD Radeon(TM) Graphics","536870912","31.0.12.0","AMD Radeon Graphics Processor","PCI\\VEN_1002&DEV_164E"
"AMD Radeon RX 7900 XTX","4294967295","31.0.24.0","Navi 31","PCI\\VEN_1002&DEV_744C"`;

    const controllers = parseWindowsVideoControllers(sampleCsv);
    assert.strictEqual(controllers.length, 2);

    const prioritized = prioritizeGpuControllers(controllers);
    assert.strictEqual(prioritized[0].name, 'AMD Radeon RX 7900 XTX');
  });

  it('should parse Intel Arc discrete GPU correctly', async () => {
    const { parseWindowsVideoControllers, prioritizeGpuControllers } = await import('./monitors/platform/windows.js');
    const sampleCsv = `"Name","AdapterRAM","DriverVersion","VideoProcessor","PNPDeviceID"
"Intel(R) UHD Graphics 770","1073741824","31.0.101.4000","Intel(R) UHD Graphics Family","PCI\\VEN_8086&DEV_4680"
"Intel(R) Arc(TM) A770 Graphics","4294967295","31.0.101.5000","Intel(R) Arc(TM) A-Series Graphics","PCI\\VEN_8086&DEV_56A0"`;

    const controllers = parseWindowsVideoControllers(sampleCsv);
    const prioritized = prioritizeGpuControllers(controllers);
    assert.strictEqual(prioritized[0].name, 'Intel(R) Arc(TM) A770 Graphics');
  });

  it('should detect CPU vendors and estimate architecture TDP accurately', async () => {
    const { detectProcessorVendor, estimateCpuTdp } = await import('./monitors/platform/windows.js');
    // AMD tests
    assert.strictEqual(detectProcessorVendor('AMD Ryzen 9 7950X 16-Core Processor'), 'amd');
    assert.strictEqual(estimateCpuTdp('AMD Ryzen 9 7950X'), 170);
    assert.strictEqual(estimateCpuTdp('AMD Ryzen 7 7800X3D'), 105);
    assert.strictEqual(estimateCpuTdp('AMD Ryzen 5 5600'), 65);

    // Intel tests
    assert.strictEqual(detectProcessorVendor('13th Gen Intel(R) Core(TM) i9-13900K'), 'intel');
    assert.strictEqual(estimateCpuTdp('Intel(R) Core(TM) i9-13900K'), 125);
    assert.strictEqual(estimateCpuTdp('Intel(R) Core(TM) Ultra 7 155H'), 45);
    assert.strictEqual(estimateCpuTdp('Intel(R) Core(TM) i5-12400'), 65);
  });

  it('should parse Windows processes with ParentProcessId (ppid) for tree view', async () => {
    const { parseWindowsProcessCsv } = await import('./monitors/platform/windows.js');
    const sampleCsv = `"Name","ProcessId","ParentProcessId","ThreadCount","WorkingSetSize","UserModeTime","KernelModeTime","CommandLine"
"explorer.exe","1024","512","48","157286400","50000000","25000000","C:\\Windows\\explorer.exe"
"chrome.exe","2048","1024","32","314572800","100000000","50000000","chrome.exe"
"python.exe","4096","1024","8","524288000","150000000","75000000","python.exe -m torch"`;

    const cache = new Map();
    const procs = parseWindowsProcessCsv(sampleCsv, 32 * 1024 * 1024 * 1024, cache, Date.now());

    assert.strictEqual(procs.length, 3);
    const explorer = procs.find(p => p.pid === 1024);
    const chrome = procs.find(p => p.pid === 2048);
    const python = procs.find(p => p.pid === 4096);

    assert.ok(explorer);
    assert.strictEqual(explorer?.ppid, 512);

    assert.ok(chrome);
    assert.strictEqual(chrome?.ppid, 1024); // Parent is explorer! Process tree works!

    assert.ok(python);
    assert.strictEqual(python?.ppid, 1024);
    assert.strictEqual(python?.isGpuOrMlAttributed, true);
  });

  it('should parse Windows TCP sockets and build per-app network usage', async () => {
    const { parseWindowsTcpConnections, buildWindowsNetworkProcesses } = await import('./monitors/platform/windows.js');
    const sampleConns = `"LocalPort","RemoteAddress","RemotePort","State","OwningProcess"
"51234","142.250.190.46","443","Established","2048"
"51235","142.250.190.46","443","Established","2048"
"8080","0.0.0.0","0","Listen","4096"`;

    const conns = parseWindowsTcpConnections(sampleConns);
    assert.strictEqual(conns.length, 3);

    const procMap = new Map([[2048, 'chrome.exe'], [4096, 'node.exe']]);
    const netProcs = buildWindowsNetworkProcesses(conns, procMap);

    assert.strictEqual(netProcs.length, 2);
    assert.strictEqual(netProcs[0].command, 'chrome.exe');
    assert.strictEqual(netProcs[0].connections.length, 2);
  });

  it('should parse Windows physical disk health and reliability', async () => {
    const { parseWindowsPhysicalDiskCsv, parseWindowsReliabilityCsv } = await import('./smartCmd.js');
    const sampleDiskCsv = `"DeviceId","FriendlyName","SerialNumber","MediaType","HealthStatus","Size"
"0","Samsung SSD 980 PRO 2TB","S5GXNX0T123456","SSD","Healthy","2000398934016"`;

    const disks = parseWindowsPhysicalDiskCsv(sampleDiskCsv);
    assert.strictEqual(disks.length, 1);
    assert.strictEqual(disks[0].model, 'Samsung SSD 980 PRO 2TB');
    assert.strictEqual(disks[0].health, 'PASSED');
    assert.strictEqual(disks[0].protocol, 'SSD');
    assert.strictEqual(disks[0].capacity, '2.0 TB');

    const sampleRelCsv = `"Temperature","Wear","PowerOnHours","ReadErrorsTotal","WriteErrorsTotal"
"42","3","4500","0","0"`;
    const rel = parseWindowsReliabilityCsv(sampleRelCsv);
    assert.strictEqual(rel.tempC, 42);
    assert.strictEqual(rel.percentUsed, 3);
    assert.strictEqual(rel.powerOnHours, 4500);
    assert.strictEqual(rel.reallocatedSectors, 0);
  });

  it('should parse Windows ARP table for topology discovery', async () => {
    const { parseWindowsArpOutput } = await import('./topoCmd.js');
    const sampleArp = `
Interface: 192.168.1.150 --- 0x3
  Internet Address      Physical Address      Type
  192.168.1.1           00-11-22-33-44-55     dynamic
  192.168.1.200         aa-bb-cc-dd-ee-ff     dynamic
`;
    const peers = parseWindowsArpOutput(sampleArp, '192.168.1.1');
    assert.strictEqual(peers.length, 2);
    assert.strictEqual(peers[0].ip, '192.168.1.1');
    assert.strictEqual(peers[0].mac, '00:11:22:33:44:55');
    assert.strictEqual(peers[0].isGateway, true);
    assert.strictEqual(peers[1].ip, '192.168.1.200');
    assert.strictEqual(peers[1].isGateway, false);
  });
});

describe('Cross-Platform Service & Package Management', () => {
  it('should report package manager health without crashing', async () => {
    const { getBrewHealth } = await import('./brewHealth.js');
    const health = await getBrewHealth();
    assert.ok(typeof health.managerName === 'string');
    assert.ok(typeof health.brewAvailable === 'boolean');
    assert.ok(typeof health.installedCount === 'number');
  });

  it('should query system extensions / drivers without crashing', async () => {
    const { getSystemExtensions } = await import('./extensions.js');
    const extensions = await getSystemExtensions();
    assert.ok(Array.isArray(extensions));
  });
});
