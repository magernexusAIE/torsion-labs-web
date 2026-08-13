#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { buildDist, verifyDist, verifySource } from './public-artifact.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = path.resolve(option('--source') ?? process.cwd());
const outputValue = option('--out');
const verifyOnly = process.argv.includes('--verify-only');

try {
  if (verifyOnly) {
    const specification = await verifySource(source);
    console.log(JSON.stringify({ status: 'PASS', mode: 'verify-source', files: specification.contract.runtime_allowlist.length }));
  } else {
    if (!outputValue) throw new Error('OUT_REQUIRED: use --out <fresh-directory>');
    const output = path.resolve(outputValue);
    const result = process.argv.includes('--verify-dist')
      ? await verifyDist(source, output)
      : await buildDist(source, output);
    console.log(JSON.stringify({ status: 'PASS', mode: 'dist', output: result.output, files: result.files.length }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message }));
  process.exitCode = 1;
}
