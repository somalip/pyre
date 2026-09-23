/**
 * pyre prometheus — Prometheus metrics exporter.
 *
 * Starts an HTTP server that exposes system metrics in the
 * Prometheus text exposition format at GET /metrics.
 * Uses the existing formatPrometheusMetrics() from prometheus.ts
 * and collectAll() from monitors/index.ts.
 *
 * No new dependencies — uses Node.js built-in http module.
 */
import http from 'node:http';
import os from 'node:os';
import { collectAll } from './monitors/index.js';
import { formatPrometheusMetrics } from './prometheus.js';
import chalk from 'chalk';

export interface PrometheusOptions {
  port: number;
  interval: number;
  detailed?: boolean;
}

export async function runPrometheusServer(opts: PrometheusOptions): Promise<void> {
  const { port, interval, detailed } = opts;

  // Pre-warm with an initial collection so /metrics is never empty on first scrape
  let latestData = await collectAll({ detailed });
  let lastCollect = Date.now();

  // Background refresh loop — collects fresh data every `interval` seconds
  const refreshTimer = setInterval(async () => {
    try {
      latestData = await collectAll({ detailed });
      lastCollect = Date.now();
    } catch {
      // Keep serving last good data on collection failure
    }
  }, interval * 1000);

  const server = http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0] ?? '/';

    if (url === '/metrics') {
      try {
        // If data is stale (> 2x interval), re-collect synchronously
        if (Date.now() - lastCollect > interval * 2000) {
          latestData = await collectAll({ detailed });
          lastCollect = Date.now();
        }
        const body = formatPrometheusMetrics(latestData);
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`# collection error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return;
    }

    if (url === '/health' || url === '/api/health') {
      const body = JSON.stringify({ status: 'ok', uptime: os.uptime(), timestamp: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Available endpoints: /metrics  /health\n');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`  ✖ Port ${port} is already in use. Try --prometheus-port <other-port>`));
    } else {
      console.error(chalk.red(`  ✖ Server error: ${err.message}`));
    }
    clearInterval(refreshTimer);
    process.exit(1);
  });

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));

  console.log(chalk.bold('\n  🔥 pyre — Prometheus Exporter\n'));
  console.log(`  ${chalk.green('✔')} Metrics endpoint: ${chalk.cyan(`http://0.0.0.0:${port}/metrics`)}`);
  console.log(`  ${chalk.green('✔')} Health endpoint:  ${chalk.cyan(`http://0.0.0.0:${port}/health`)}`);
  console.log(`  ${chalk.dim(`Refresh interval: ${interval}s  |  Detailed mode: ${detailed ? 'on' : 'off'}`)}`);
  console.log(`\n  ${chalk.dim('Add to prometheus.yml:')}`);
  console.log(chalk.dim(`    - job_name: 'pyre'`));
  console.log(chalk.dim(`      static_configs:`));
  console.log(chalk.dim(`        - targets: ['localhost:${port}']`));
  console.log(`\n  ${chalk.dim('Press Ctrl+C to stop.')}\n`);

  const shutdown = () => {
    clearInterval(refreshTimer);
    server.close(() => {
      console.log(chalk.dim('\n  Prometheus server stopped.'));
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise<void>(() => { /* runs until signal */ });
}
