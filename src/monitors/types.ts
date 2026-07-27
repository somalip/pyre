/**
 * Core data types for system metric collection.
 *
 * Every interface in this file represents a distinct category of
 * system information gathered by the monitors module.  The
 * {@link StatsData} aggregate ties them together for downstream
 * formatting and export.
 */

export interface StatsData {
   header: { title: string; hostname: string; os: string; uptime: string };
   cpu: CpuData;
   gpu: GpuData | null;
   memory: MemoryData;
   disk: DiskData[];
   battery: BatteryData | null;
   thermal: ThermalData;
   network: NetworkData;
   processes: ProcessData[];
   power: PowerData | null;
   timestamp: string;
 }

export interface GpuData {
   model: string;
   memory: number;
   utilization: number;
   temperature?: number;
   processes: number;
 }

 export interface PowerData {
   cpuWatts?: number;
   gpuWatts?: number;
   combinedWatts?: number;
 }

export interface CpuData {
  brand: string;
  cores: number;
  physicalCores: number;
  frequency: number;
  usage: number;
  loadAvg: number[];
  temperature?: number;
}

export interface MemoryData {
  total: number;
  used: number;
  free: number;
  swapTotal: number;
  swapUsed: number;
  swapFree: number;
  pageSize: number;
  usagePercent: number;
}

export interface ThermalData {
  state: string;
  detail?: string;
  /** Normalized 0-3 scale (nominal/fair/serious/critical) derived from `state`, for graphing/coloring */
  pressureLevel: number;
  temperatures?: Record<string, number | null>;
  error?: string;
}

export interface BatteryData {
  level: number;
  state: string;
  timeRemaining: string;
  health: string;
  powerSource: string;
  cycles?: number;
  condition?: string;
  maxCapacityPercent?: number;
}

export interface DiskData {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  capacity: string;
  mountpoint: string;
}

export interface NetworkData {
  interface: string;
  ip: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
}

export interface ProcessData {
   pid: number;
   ppid: number;
   user: string;
   cpu: number;
   mem: number;
   command: string;
   state: string;
   threads: number;
   runtime: number;
}