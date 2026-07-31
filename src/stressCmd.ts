import { Worker, isMainThread, workerData } from 'node:worker_threads';
import os from 'node:os';
import chalk from 'chalk';

export interface StressOptions {
  durationSec?: number;
  cores?: number;
}

if (!isMainThread) {
  // Worker thread busywork loop
  const endTime = workerData?.endTime;
  while (true) {
    if (endTime && Date.now() >= endTime) {
      break;
    }
    Math.hypot(Math.random(), Math.random());
  }
  process.exit(0);
}

export async function runStressCommand(opts: StressOptions = {}): Promise<void> {
  const durationSec = opts.durationSec ?? 30;
  const numCores = opts.cores ?? os.cpus().length;
  const endTime = Date.now() + durationSec * 1000;

  console.log(chalk.bold(`\n  pyre stress — Synthetic Load Generator`));
  console.log(chalk.dim(`  Spawning ${numCores} worker threads for ${durationSec} seconds...`));
  console.log(chalk.dim(`  Press Ctrl+C to stop early.\n`));

  const workers: Worker[] = [];

  for (let i = 0; i < numCores; i++) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { endTime },
    });
    workers.push(worker);
  }

  const cleanup = () => {
    for (const w of workers) {
      w.terminate();
    }
  };

  process.once('SIGINT', () => {
    cleanup();
    console.log(chalk.yellow('\n  Stress test cancelled by user.'));
    process.exit(0);
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      console.log(chalk.green(`  ✔ Synthetic load test completed after ${durationSec}s.`));
      resolve();
    }, durationSec * 1000);
  });
}
