import { defineConfig } from 'tsup';
import fs from 'node:fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: false,
  onSuccess: async () => {
    try {
      fs.copyFileSync('src/monitors/ioreport.py', 'dist/ioreport.py');
    } catch {
      // ignore
    }
    try {
      if (!fs.existsSync('dist/monitors/platform')) {
        fs.mkdirSync('dist/monitors/platform', { recursive: true });
      }
      fs.copyFileSync('src/monitors/platform/windows-ui.ps1', 'dist/monitors/platform/windows-ui.ps1');
    } catch {
      // ignore
    }
  },
});

