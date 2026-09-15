import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
  'demo-access-token',
  'ALLOW_SYNTHETIC_CONTENT',
  'DEMO_MODE',
  'createMockDatabase',
  'tenant_db.json',
  'MockRedis',
  'MockQueue'
];

const files = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (['.js', '.cjs', '.html'].includes(extname(entry.name))) files.push(path);
  }
};

await visit(fileURLToPath(new URL('../dist', import.meta.url)));
if (!files.length) throw new Error('Production bundle is missing');
for (const file of files) {
  const body = await readFile(file, 'utf8');
  const match = forbidden.find((token) => body.includes(token));
  if (match) throw new Error(`Forbidden production fallback ${match} found in ${file}`);
}

process.stdout.write(`Verified ${files.length} production bundle files: no demo, synthetic-data, JSON-database or memory-queue fallback.\n`);
