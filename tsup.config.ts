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
  },
});

