import { collectAll } from './monitors/index.js';

export interface PipeOptions {
  intervalMs?: number;
  samples?: number;
  detailed?: boolean;
}

export async function runPipeCommand(opts: PipeOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 1000;
  const maxSamples = opts.samples ?? 0; // 0 = forever

  let count = 0;

  const emitSample = async () => {
    try {
      const data = await collectAll({ detailed: opts.detailed });
      process.stdout.write(JSON.stringify(data) + '\n');
      count++;
      if (maxSamples > 0 && count >= maxSamples) {
        process.exit(0);
      }
    } catch (err: any) {
      process.stderr.write(`Error collecting stats: ${err.message}\n`);
    }
  };

  await emitSample();

  if (maxSamples > 0 && count >= maxSamples) {
    return;
  }

  const timer = setInterval(async () => {
    await emitSample();
  }, intervalMs);

  process.once('SIGINT', () => {
    clearInterval(timer);
    process.exit(0);
  });
}
