import chalk from 'chalk';

export async function runBenchmarkCommand(): Promise<void> {
  console.log(chalk.bold('\n  pyre CPU Benchmark'));
  console.log(chalk.dim('  Calculating digits of Pi to benchmark single-core CPU performance.'));
  console.log(chalk.dim('  This will take exactly 1 minute. Please wait...\n'));

  const durationMs = 60 * 1000;
  const endTime = Date.now() + durationMs;
  let digitsCalculated = 0;

  let q = 1n, r = 0n, t = 1n, k = 1n, n = 3n, l = 3n;

  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIdx = 0;
  
  const reportInterval = 250; // ms
  let lastReport = Date.now();

  process.stdout.write('\x1b[?25l'); // Hide cursor

  try {
    while (Date.now() < endTime) {
      // Calculate a batch of iterations
      // We do 100 iterations at a time to keep the event loop responsive
      for (let i = 0; i < 100; i++) {
        if (4n * q + r - t < n * t) {
          digitsCalculated++;
          const nr = 10n * (r - n * t);
          n = (10n * (3n * q + r)) / t - 10n * n;
          q *= 10n;
          r = nr;
        } else {
          const nr = (2n * q + r) * l;
          const nn = (q * (7n * k) + 2n + r * l) / (t * l);
          q *= k;
          t *= l;
          l += 2n;
          k += 1n;
          n = nn;
          r = nr;
        }
      }
      
      const now = Date.now();
      if (now - lastReport > reportInterval) {
        const elapsed = Math.floor((now - (endTime - durationMs)) / 1000);
        const remaining = Math.max(0, 60 - elapsed);
        
        process.stdout.write(`\r  ${chalk.cyan(spinnerChars[spinnerIdx])} ${chalk.yellow(digitsCalculated)} digits calculated... ${remaining}s remaining   `);
        spinnerIdx = (spinnerIdx + 1) % spinnerChars.length;
        lastReport = now;
        
        // Yield to event loop
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  } finally {
    process.stdout.write('\x1b[?25h'); // Show cursor
  }

  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear line
  
  console.log(chalk.green(`  ✔ Benchmark complete!`));
  console.log(chalk.bold(`  Digits calculated: ${chalk.cyan(digitsCalculated)}`));
  
  const score = Math.floor(digitsCalculated);
  console.log(chalk.bold(`  pyre Score:        ${chalk.green(score)}\n`));
}
