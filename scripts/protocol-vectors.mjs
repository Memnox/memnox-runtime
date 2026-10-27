// Writes vectors/protocol.json from the built core, so every client is tested against what the runtime really builds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protocolVectorsJson } from '../packages/core/dist/index.js';

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vectors',
  'protocol.json',
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, protocolVectorsJson());
console.log(`wrote ${out}`);
