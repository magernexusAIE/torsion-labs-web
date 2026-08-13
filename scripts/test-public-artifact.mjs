#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildDist, verifyDist, verifySource } from './public-artifact.mjs';

const source = path.resolve(process.argv[2] ?? process.cwd());
const temp = await mkdtemp(path.join(os.tmpdir(), 'torsion-web-artifact-test-'));
const results = [];

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function resealFile(root, relative) {
  const manifestPath = path.join(root, 'config', 'public-artifact-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(path.join(root, ...relative.split('/')));
  const entry = manifest.files.find((candidate) => candidate.path === relative);
  if (!entry) throw new Error(`TEST_MANIFEST_ENTRY_MISSING:${relative}`);
  entry.sha256 = hash(bytes);
  entry.bytes = bytes.length;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyGovernedSource(destination) {
  const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
  const governed = [...contract.runtime_allowlist, ...contract.repository_only];
  for (const relative of governed) {
    const target = path.join(destination, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, ...relative.split('/')), target);
  }
}

async function expectPass(name, operation) {
  await operation();
  results.push({ name, status: 'PASS' });
}

async function expectFail(name, expectedCode, operation) {
  try {
    await operation();
    throw new Error(`EXPECTED_FAILURE_NOT_OBSERVED:${expectedCode}`);
  } catch (error) {
    if (!error.message.startsWith(expectedCode)) throw error;
    results.push({ name, status: 'PASS', rejected_by: expectedCode });
  }
}

try {
  const baseline = path.join(temp, 'baseline');
  await expectPass('sealed_source', () => verifySource(source));
  await expectPass('deterministic_build', () => buildDist(source, baseline));
  await expectPass('exact_dist', () => verifyDist(source, baseline));

  const extra = path.join(temp, 'extra');
  await cp(baseline, extra, { recursive: true });
  await writeFile(path.join(extra, 'README.md'), 'not runtime\n');
  await expectFail('reject_extra_file', 'DIST_FILESET_MISMATCH', () => verifyDist(source, extra));

  const missing = path.join(temp, 'missing');
  await cp(baseline, missing, { recursive: true });
  await unlink(path.join(missing, '404.html'));
  await expectFail('reject_missing_file', 'DIST_FILESET_MISMATCH', () => verifyDist(source, missing));

  const tampered = path.join(temp, 'tampered');
  await cp(baseline, tampered, { recursive: true });
  await writeFile(path.join(tampered, 'index.html'), 'tampered\n');
  await expectFail('reject_tampered_bytes', 'DIST_HASH_MISMATCH', () => verifyDist(source, tampered));

  const nested = path.join(temp, 'nested-extra');
  await cp(baseline, nested, { recursive: true });
  await mkdir(path.join(nested, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(nested, '.github', 'workflows', 'ci.yml'), 'forbidden\n');
  await expectFail('reject_repository_metadata', 'DIST_FILESET_MISMATCH', () => verifyDist(source, nested));

  const sourceTamper = path.join(temp, 'source-tamper');
  await copyGovernedSource(sourceTamper);
  const index = path.join(sourceTamper, 'index.html');
  await writeFile(index, `${await readFile(index, 'utf8')}\n`);
  await expectFail('reject_source_hash_drift', 'SOURCE_SIZE_MISMATCH', () => verifySource(sourceTamper));

  const noindex = path.join(temp, 'noindex');
  await copyGovernedSource(noindex);
  const notFound = path.join(noindex, '404.html');
  await writeFile(notFound, (await readFile(notFound, 'utf8')).replace('noindex,nofollow', 'index,follow'));
  await resealFile(noindex, '404.html');
  await expectFail('reject_indexable_404', '404_NOINDEX_MISSING', () => verifySource(noindex));

  const csp = path.join(temp, 'csp');
  await copyGovernedSource(csp);
  const headers = path.join(csp, '_headers');
  await writeFile(headers, (await readFile(headers, 'utf8')).replace(/^\s*Content-Security-Policy:.*\r?\n/m, ''));
  await resealFile(csp, '_headers');
  await expectFail('reject_missing_csp', 'SECURITY_HEADER_MISSING', () => verifySource(csp));

  const brokenLink = path.join(temp, 'broken-link');
  await copyGovernedSource(brokenLink);
  const brokenIndex = path.join(brokenLink, 'index.html');
  await writeFile(brokenIndex, (await readFile(brokenIndex, 'utf8')).replace('href="/ciencia/"', 'href="/ruta-ausente/"'));
  await resealFile(brokenLink, 'index.html');
  await expectFail('reject_link_outside_allowlist', 'REFERENCE_OUTSIDE_ALLOWLIST', () => verifySource(brokenLink));

  const mime = path.join(temp, 'mime');
  await copyGovernedSource(mime);
  const mimeManifestPath = path.join(mime, 'config', 'public-artifact-manifest.json');
  const mimeManifest = JSON.parse(await readFile(mimeManifestPath, 'utf8'));
  mimeManifest.files.find((entry) => entry.path === '404.html').mime = 'application/octet-stream';
  await writeFile(mimeManifestPath, `${JSON.stringify(mimeManifest, null, 2)}\n`);
  await expectFail('reject_mime_drift', 'MANIFEST_MIME_INVALID', () => verifySource(mime));

  console.log(JSON.stringify({ status: 'PASS', tests: results.length, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
