import { collectAll } from './dist/monitors/index.js';
console.time('collectAll');
await collectAll({ detailed: false });
console.timeEnd('collectAll');
