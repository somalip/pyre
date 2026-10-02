#!/usr/bin/env node
/**
 * scripts/generate-commands.js
 * Parses src/index.ts for commands in program.addHelpText
 * and generates formatted Markdown / HTML tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'src', 'index.ts');

const indexSrc = fs.readFileSync(indexPath, 'utf-8');
const match = indexSrc.match(/program\.addHelpText\('after',\s*`([\s\S]*?)`\);/);

if (!match) {
  console.error('Could not find program.addHelpText in src/index.ts');
  process.exit(1);
}

const lines = match[1].split('\n');
const commands = [];

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('Commands:')) continue;
  
  const cmdMatch = line.match(/^\s{3,5}(\S.*?)\s{2,}(.+)$/);
  if (cmdMatch) {
    const rawCmd = cmdMatch[1].trim();
    const desc = cmdMatch[2].trim();
    commands.push({ rawCmd, desc });
  }
}

console.log(`Extracted ${commands.length} commands from src/index.ts:`);
commands.forEach(c => console.log(` - pyre ${c.rawCmd}: ${c.desc}`));

export { commands };
