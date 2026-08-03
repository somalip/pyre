import { collectAll } from './src/monitors/collectors.js';
console.time('collectAll');
await collectAll({ detailed: false });
console.timeEnd('collectAll');
