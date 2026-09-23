/**
 * pyre build — Active Build System Tracker.
 *
 * Discovers running compilation and build tools (xcodebuild, cargo, swift,
 * make, ninja, bazel, go), displaying real-time compiler workers, parallelism,
 * and CPU/RAM footprints.
 */
import chalk from 'chalk';
import { collectBuilds } from './monitors/buildTracker.js';

export interface BuildOptions {
  watch?: boolean;
  json?: boolean;
}

export async function runBuildCommand(opts: BuildOptions = {}): Promise<void> {
  const builds = await collectBuilds();

  if (opts.json) {
    console.log(JSON.stringify({ activeBuilds: builds }, null, 2));
    return;
  }

  console.log(chalk.bold('\n  🔥 pyre build — Active Build System Tracker\n'));

  if (builds.length === 0) {
    console.log(chalk.dim('  No active build or compilation processes detected.'));
    console.log(chalk.dim('  (Supports: xcodebuild, cargo, swift build, make, ninja, bazel, go build)\n'));
    return;
  }

  for (const b of builds) {
    const elapsedMins = Math.floor(b.elapsedSec / 60);
    const elapsedSecs = b.elapsedSec % 60;
    const timeStr = elapsedMins > 0 ? `${elapsedMins}m ${elapsedSecs}s` : `${elapsedSecs}s`;

    console.log(`  ${chalk.bgCyan.black.bold(` ${b.tool.toUpperCase()} `)}  ${chalk.bold(`PID ${b.rootPid}`)}`);
    console.log(`    Command:          ${chalk.white(b.command)}`);
    if (b.target) {
      console.log(`    Target:           ${chalk.cyan(b.target)}`);
    }
    console.log(`    Compiler Workers: ${chalk.green.bold(String(b.compilerProcesses))} active thread/processes`);
    console.log(`    Combined CPU:     ${chalk.yellow.bold(b.totalCpu.toFixed(1) + '%')}`);
    console.log(`    Combined RAM:     ${chalk.magenta(b.totalMem.toFixed(1) + '%')}`);
    console.log(`    Elapsed Time:     ${chalk.dim(timeStr)}`);
    console.log();
  }
}
