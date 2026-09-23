/**
 * pyre serve — Dedicated REST API Mode.
 *
 * Exposes all metrics as structured JSON REST endpoints with optional
 * API key authorization and CORS support.
 *
 * Endpoints:
 *   GET /api/all
 *   GET /api/cpu
 *   GET /api/memory
 *   GET /api/gpu
 *   GET /api/battery
 *   GET /api/thermal
 *   GET /api/network
 *   GET /api/disk
 *   GET /api/processes
 *   GET /api/containers
 *   GET /api/system
 */
import http from 'node:http';
import os from 'node:os';
import chalk from 'chalk';
import {
  collectAll,
  collectCpu,
  collectMemory,
  collectGpu,
  collectBattery,
  collectThermal,
  collectNetwork,
  collectDisk,
  collectProcesses,
  collectContainers,
  collectSystem,
} from './monitors/collectors.js';

export interface ServeOptions {
  port?: number;
  apiKey?: string;
  detailed?: boolean;
}

export async function runServeCommand(opts: ServeOptions = {}): Promise<void> {
  const port = opts.port || 8080;
  const apiKey = opts.apiKey || process.env.PYRE_API_KEY || '';

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = urlObj.pathname;

    // Optional API key validation
    if (apiKey) {
      const authHeader = req.headers['authorization'] || '';
      const xApiKey = req.headers['x-api-key'] || '';
      const queryKey = urlObj.searchParams.get('key') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

      if (token !== apiKey && xApiKey !== apiKey && queryKey !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
        return;
      }
    }

    try {
      let data: any;

      switch (pathname) {
        case '/api/all':
        case '/api/stats':
        case '/api':
          data = await collectAll({ detailed: opts.detailed });
          break;
        case '/api/cpu':
          data = await collectCpu();
          break;
        case '/api/memory':
        case '/api/mem':
          data = await collectMemory();
          break;
        case '/api/gpu':
          data = await collectGpu(opts.detailed);
          break;
        case '/api/battery':
        case '/api/power':
          data = await collectBattery();
          break;
        case '/api/thermal':
        case '/api/temp':
          data = await collectThermal(opts.detailed);
          break;
        case '/api/network':
        case '/api/net':
          data = await collectNetwork();
          break;
        case '/api/disk':
          data = await collectDisk();
          break;
        case '/api/processes':
        case '/api/proc':
          data = await collectProcesses(50);
          break;
        case '/api/containers':
          data = await collectContainers();
          break;
        case '/api/system':
        case '/api/info':
          data = await collectSystem();
          break;
        case '/health':
        case '/api/health':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: os.uptime(), timestamp: new Date().toISOString() }));
          return;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not found',
            availableEndpoints: [
              '/api/all',
              '/api/cpu',
              '/api/memory',
              '/api/gpu',
              '/api/battery',
              '/api/thermal',
              '/api/network',
              '/api/disk',
              '/api/processes',
              '/api/containers',
              '/api/system',
              '/api/health',
            ],
          }));
          return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal metric collection error' }));
    }
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`\n  ✖ Error: Port ${port} is already in use. Use --port <port> to select an alternate port.\n`));
    } else {
      console.error(chalk.red(`\n  ✖ Server error: ${err.message}\n`));
    }
    process.exit(1);
  });

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));

  console.log(chalk.bold('\n  🔥 pyre serve — REST API Server\n'));
  console.log(`  ${chalk.green('✔')} API base URL: ${chalk.cyan(`http://0.0.0.0:${port}/api/all`)}`);
  console.log(`  ${chalk.green('✔')} Health check: ${chalk.cyan(`http://0.0.0.0:${port}/api/health`)}`);
  if (apiKey) {
    console.log(`  ${chalk.yellow('🔒')} API Key protection: ${chalk.bold('ENABLED')} (Pass via header x-api-key or ?key=)`);
  } else {
    console.log(`  ${chalk.dim('🔓')} API Key protection: ${chalk.dim('DISABLED (Public local network access)')}`);
  }
  console.log(`\n  ${chalk.dim('Endpoints: /api/cpu, /api/memory, /api/gpu, /api/battery, /api/thermal, /api/network, /api/disk, /api/processes')}`);
  console.log(chalk.dim('\n  Press Ctrl+C to stop.\n'));

  // Keep alive
  await new Promise<void>(() => {});
}
