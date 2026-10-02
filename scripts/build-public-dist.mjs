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
const releasePrivacy = process.argv.includes('--release-privacy');
const syntheticPrivacy = process.argv.includes('--synthetic-privacy');
const options = syntheticPrivacy ? { syntheticPrivacy: true } : releasePrivacy ? {
  releasePrivacy: true,
  publicationGate: process.env.TORSION_NOTICE_RELEASE_GATE,
  branch: process.env.CF_PAGES_BRANCH,
  publicationValues: {
    controllerName: process.env.TORSION_NOTICE_CONTROLLER_NAME,
    controllerAddress: process.env.TORSION_NOTICE_CONTROLLER_ADDRESS,
    privacyEmail: process.env.TORSION_NOTICE_PRIVACY_EMAIL,
    effectiveDate: process.env.TORSION_NOTICE_EFFECTIVE_DATE,
  },
} : undefined;

try {
  if (syntheticPrivacy && releasePrivacy) throw new Error('PRIVACY_MODE_CONFLICT');
  if (syntheticPrivacy && (process.env.GITHUB_ACTIONS !== 'true' || process.env.CF_PAGES === '1')) {
    throw new Error('SYNTHETIC_PRIVACY_CI_ONLY');
  }
  if (verifyOnly) {
    const specification = await verifySource(source);
    console.log(JSON.stringify({ status: 'PASS', mode: 'verify-source', files: specification.contract.runtime_allowlist.length }));
  } else {
    if (!outputValue) throw new Error('OUT_REQUIRED: use --out <fresh-directory>');
    if (releasePrivacy && process.env.CF_PAGES !== '1') throw new Error('PRIVACY_RELEASE_ENVIRONMENT_INVALID');
    const output = path.resolve(outputValue);
    const result = process.argv.includes('--verify-dist')
      ? await verifyDist(source, output, options)
      : await buildDist(source, output, options);
    console.log(JSON.stringify({ status: 'PASS', mode: 'dist', output: result.output, files: result.files.length }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message }));
  process.exitCode = 1;
}
