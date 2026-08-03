import { collectCpu, collectGpu, collectMemory, collectDisk, collectBattery, collectThermal, collectNetwork, collectProcesses, collectPower, collectPackets, collectTasks, collectContainers } from './src/monitors/collectors.js';
import { collectBlenderRenders } from './src/monitors/blender.js';

async function testAll() {
  console.time('collectCpu');
  await collectCpu();
  console.timeEnd('collectCpu');

  console.time('collectGpu');
  await collectGpu();
  console.timeEnd('collectGpu');

  console.time('collectMemory');
  await collectMemory();
  console.timeEnd('collectMemory');

  console.time('collectDisk');
  await collectDisk();
  console.timeEnd('collectDisk');

  console.time('collectBattery');
  await collectBattery();
  console.timeEnd('collectBattery');

  console.time('collectThermal');
  await collectThermal();
  console.timeEnd('collectThermal');

  console.time('collectNetwork');
  await collectNetwork();
  console.timeEnd('collectNetwork');

  console.time('collectProcesses');
  await collectProcesses();
  console.timeEnd('collectProcesses');

  console.time('collectPower');
  await collectPower();
  console.timeEnd('collectPower');

  console.time('collectPackets');
  await collectPackets();
  console.timeEnd('collectPackets');

  console.time('collectTasks');
  await collectTasks();
  console.timeEnd('collectTasks');

  console.time('collectContainers');
  await collectContainers();
  console.timeEnd('collectContainers');

  console.time('collectBlenderRenders');
  await collectBlenderRenders();
  console.timeEnd('collectBlenderRenders');
}
testAll();
