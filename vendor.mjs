// Copies the two dependencies into vendor/ so the extension loads them as local
// files. Manifest V3 forbids remote code, and there is no bundler here on purpose.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('vendor', { recursive: true });
cpSync('node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm', 'vendor/sqlite', { recursive: true });
cpSync('node_modules/@mozilla/readability/Readability.js', 'vendor/Readability.js');
console.log('vendored');
