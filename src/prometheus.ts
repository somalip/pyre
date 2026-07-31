import type { StatsData } from './monitors/types.js';

export function formatPrometheusMetrics(data: StatsData): string {
  const lines: string[] = [];

  // Helper to append metric family
  const addGauge = (name: string, help: string, val: number | undefined, labels: Record<string, string> = {}) => {
    if (val === undefined || Number.isNaN(val)) return;
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
    const labelSuffix = labelStr ? `{${labelStr}}` : '';
    lines.push(`${name}${labelSuffix} ${val}`);
  };

  // CPU metrics
  addGauge('pyre_cpu_usage_percent', 'CPU usage percentage', data.cpu.usage);
  addGauge('pyre_cpu_frequency_mhz', 'CPU frequency in MHz', data.cpu.frequency);
  addGauge('pyre_cpu_cores_physical', 'Physical CPU core count', data.cpu.physicalCores);
  addGauge('pyre_cpu_cores_logical', 'Logical CPU core count', data.cpu.cores);

  if (data.cpu.loadAvg && data.cpu.loadAvg.length >= 3) {
    addGauge('pyre_cpu_load_1m', '1-minute load average', data.cpu.loadAvg[0]);
    addGauge('pyre_cpu_load_5m', '5-minute load average', data.cpu.loadAvg[1]);
    addGauge('pyre_cpu_load_15m', '15-minute load average', data.cpu.loadAvg[2]);
  }

  if (data.cpu.temperature) {
    addGauge('pyre_cpu_temperature_celsius', 'CPU die temperature in Celsius', data.cpu.temperature);
  }

  // Memory metrics
  addGauge('pyre_memory_total_bytes', 'Total RAM in bytes', data.memory.total);
  addGauge('pyre_memory_used_bytes', 'Used RAM in bytes', data.memory.used);
  addGauge('pyre_memory_free_bytes', 'Free RAM in bytes', data.memory.free);
  addGauge('pyre_memory_usage_percent', 'Memory usage percentage', data.memory.usagePercent);

  if (data.memory.swapTotal) {
    addGauge('pyre_memory_swap_total_bytes', 'Total swap memory in bytes', data.memory.swapTotal);
    addGauge('pyre_memory_swap_used_bytes', 'Used swap memory in bytes', data.memory.swapUsed);
  }

  // GPU metrics
  if (data.gpu) {
    addGauge('pyre_gpu_utilization_percent', 'GPU utilization percentage', data.gpu.utilization, { model: data.gpu.model });
    addGauge('pyre_gpu_memory_bytes', 'GPU memory size in bytes', data.gpu.memory, { model: data.gpu.model });
    if (data.gpu.temperature) {
      addGauge('pyre_gpu_temperature_celsius', 'GPU temperature in Celsius', data.gpu.temperature, { model: data.gpu.model });
    }
  }

  // Power metrics
  if (data.power) {
    if (data.power.cpuWatts) addGauge('pyre_power_cpu_watts', 'CPU power draw in Watts', data.power.cpuWatts);
    if (data.power.gpuWatts) addGauge('pyre_power_gpu_watts', 'GPU power draw in Watts', data.power.gpuWatts);
    if (data.power.combinedWatts) addGauge('pyre_power_system_watts', 'Combined system power draw in Watts', data.power.combinedWatts);
  }

  // Battery metrics
  if (data.battery) {
    addGauge('pyre_battery_level_percent', 'Battery level percentage', data.battery.level);
    if (data.battery.cycles) addGauge('pyre_battery_cycle_count', 'Battery cycle count', data.battery.cycles);
    if (data.battery.maxCapacityPercent) addGauge('pyre_battery_max_capacity_percent', 'Battery health maximum capacity percentage', data.battery.maxCapacityPercent);
  }

  // Thermal metrics
  addGauge('pyre_thermal_pressure_level', 'Thermal pressure level (0=Nominal, 1=Fair, 2=Serious, 3=Critical)', data.thermal.pressureLevel);

  // Network metrics
  addGauge('pyre_network_rx_bytes_total', 'Total network received bytes', data.network.rxBytes);
  addGauge('pyre_network_tx_bytes_total', 'Total network transmitted bytes', data.network.txBytes);

  return lines.join('\n') + '\n';
}
