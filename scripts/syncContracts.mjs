#!/usr/bin/env node
/**
 * Shared-contracts sync: copies src/contracts/*.ts into the mobile app
 * (sibling checkout by default) so both codebases compile against ONE wire
 * dictionary. "Server changed, app didn't know" becomes a build failure.
 *
 *   node scripts/syncContracts.mjs           write the mobile copies
 *   node scripts/syncContracts.mjs --check   exit 1 if any copy drifted
 *
 * Destination override: CONTRACTS_DEST=/path/to/sawa/src/contracts
 * Runs in both repos' gates; lands in CI with the pipeline.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src/contracts');
const destDir = process.env.CONTRACTS_DEST
  ? resolve(process.env.CONTRACTS_DEST)
  : resolve(here, '../../sawa/src/contracts');

const check = process.argv.includes('--check');

if (!existsSync(srcDir)) {
  console.error(`[contracts] source missing: ${srcDir}`);
  process.exit(1);
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
if (files.length === 0) {
  console.error('[contracts] no contract files found — refusing to sync nothing');
  process.exit(1);
}

let drifted = [];
for (const f of files) {
  const src = readFileSync(join(srcDir, f), 'utf8');
  const destPath = join(destDir, f);
  const dest = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
  if (src === dest) continue;
  if (check) {
    drifted.push(f);
  } else {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(destPath, src);
    console.log(`[contracts] synced ${f}`);
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error(
      `[contracts] DRIFT in: ${drifted.join(', ')}\n` +
        '  The mobile copies no longer match the server source of truth.\n' +
        '  Fix: edit sawa_server/src/contracts, then run: node scripts/syncContracts.mjs',
    );
    process.exit(1);
  }
  console.log(`[contracts] in sync (${files.length} files)`);
} else {
  console.log(`[contracts] done (${files.length} files -> ${destDir})`);
}
