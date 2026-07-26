import { collectAll } from './monitors.js';
import { formatTable } from './formatters.js';

let intervalId: number | null = null;
let running = false;

export async function startLive(opts: { interval: number; detailed?: boolean }) {
  if (running) return;
  running = true;
  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[2J\x1b[H');
  process.title = 'pyre';

  const tick = async () => {
    try {
      const data = await collectAll({ detailed: opts.detailed });
      const output = `\n${formatTable(data)}\n\nPress Ctrl+C to exit...`;
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(output);
    } catch {
      // skip bad tick
    }
  };

  await tick();
  intervalId = setInterval(tick, opts.interval * 1000);

  process.once('SIGINT', () => {
    stopLive();
  });
}

export function stopLive() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  running = false;
  process.stdout.write('\x1b[?1049l');
  process.stdout.write('\x1b[2J\x1b[H');
}
