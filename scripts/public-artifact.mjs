import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const CONTRACT_PATH = 'config/public-artifact-contract.json';
export const MANIFEST_PATH = 'config/public-artifact-manifest.json';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function fail(code, details = '') {
  const suffix = details ? `: ${details}` : '';
  throw new Error(`${code}${suffix}`);
}

function normalizeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\')) {
    fail('INVALID_RELATIVE_PATH', `${label}=${String(value)}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..') {
    fail('UNSAFE_RELATIVE_PATH', `${label}=${value}`);
  }
  return value;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    normalizeRelative(value, label);
    if (seen.has(value)) fail('DUPLICATE_PATH', `${label}=${value}`);
    seen.add(value);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function walkFiles(root, current = '') {
  const directory = path.join(root, ...current.split('/').filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail('SYMLINK_FORBIDDEN', relative);
    if (entry.isDirectory()) files.push(...await walkFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
    else fail('UNSUPPORTED_FILESYSTEM_ENTRY', relative);
  }
  return files;
}

function expectedMime(contract, relative) {
  if (relative === '_headers') return contract.mime_by_extension._headers;
  const extension = path.posix.extname(relative);
  const mime = contract.mime_by_extension[extension];
  if (!mime) fail('MIME_NOT_DECLARED', relative);
  return mime;
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}

export async function loadSpecification(sourceRoot) {
  const root = path.resolve(sourceRoot);
  const contractFile = path.join(root, ...CONTRACT_PATH.split('/'));
  const manifestFile = path.join(root, ...MANIFEST_PATH.split('/'));
  const [contractBytes, manifest] = await Promise.all([
    readFile(contractFile),
    readJson(manifestFile),
  ]);
  const contract = JSON.parse(contractBytes.toString('utf8'));

  if (contract.schema_version !== 1 || contract.contract_id !== 'TORSION_WEB_PUBLIC_ARTIFACT_V1') {
    fail('CONTRACT_IDENTITY_INVALID');
  }
  for (const key of ['runtime_allowlist', 'repository_only', 'forbidden_dist_prefixes', 'forbidden_dist_files', 'required_security_headers']) {
    if (!Array.isArray(contract[key])) fail('CONTRACT_ARRAY_MISSING', key);
  }
  assertUnique(contract.runtime_allowlist, 'runtime_allowlist');
  assertUnique(contract.repository_only, 'repository_only');
  assertUnique(contract.forbidden_dist_files, 'forbidden_dist_files');
  if (contract.runtime_allowlist.some((item) => contract.repository_only.includes(item))) {
    fail('RUNTIME_REPOSITORY_OVERLAP');
  }

  if (manifest.schema_version !== 1 || manifest.contract_id !== contract.contract_id || !Array.isArray(manifest.files)) {
    fail('MANIFEST_IDENTITY_INVALID');
  }
  const contractHash = sha256(contractBytes);
  if (manifest.contract_sha256 !== contractHash) fail('CONTRACT_HASH_MISMATCH');
  const manifestPaths = manifest.files.map((entry) => entry.path);
  assertUnique(manifestPaths, 'manifest');
  if (!sameMembers(contract.runtime_allowlist, manifestPaths)) fail('MANIFEST_ALLOWLIST_MISMATCH');

  const manifestByPath = new Map();
  for (const entry of manifest.files) {
    if (!/^[A-F0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      fail('MANIFEST_ENTRY_INVALID', entry.path);
    }
    if (entry.mime !== expectedMime(contract, entry.path)) fail('MANIFEST_MIME_INVALID', entry.path);
    manifestByPath.set(entry.path, entry);
  }
  return { root, contract, contractHash, manifest, manifestByPath };
}

function routeToArtifact(raw, sourceFile, allowlist) {
  const withoutFragment = raw.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  if (!withoutQuery) return sourceFile;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(withoutQuery)) return null;

  let pathname;
  if (/^https?:\/\//i.test(withoutQuery)) {
    const url = new URL(withoutQuery);
    if (!['torsion-labs.com', 'www.torsion-labs.com', 'torsion-labs-web.pages.dev'].includes(url.hostname)) {
      fail('EXTERNAL_REFERENCE_FORBIDDEN', `${sourceFile} -> ${raw}`);
    }
    pathname = url.pathname;
  } else if (withoutQuery.startsWith('/')) {
    pathname = withoutQuery;
  } else {
    const baseDirectory = path.posix.dirname(`/${sourceFile}`);
    pathname = path.posix.resolve(baseDirectory, withoutQuery);
  }

  let candidate = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!candidate) candidate = 'index.html';
  else if (candidate.endsWith('/')) candidate += 'index.html';
  else if (!allowlist.has(candidate) && allowlist.has(`${candidate}/index.html`)) candidate += '/index.html';
  return candidate;
}

async function validateReferences(specification) {
  const allowlist = new Set(specification.contract.runtime_allowlist);
  const htmlByPath = new Map();
  for (const relative of specification.contract.runtime_allowlist.filter((item) => item.endsWith('.html'))) {
    htmlByPath.set(relative, await readFile(path.join(specification.root, ...relative.split('/')), 'utf8'));
  }

  for (const [sourceFile, html] of htmlByPath) {
    const references = [...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
    for (const reference of references) {
      const target = routeToArtifact(reference, sourceFile, allowlist);
      if (target === null) continue;
      if (!allowlist.has(target)) fail('REFERENCE_OUTSIDE_ALLOWLIST', `${sourceFile} -> ${reference} -> ${target}`);
      const fragment = reference.includes('#') ? reference.slice(reference.indexOf('#') + 1) : '';
      if (fragment) {
        const targetHtml = htmlByPath.get(target);
        if (!targetHtml) fail('FRAGMENT_TARGET_NOT_HTML', `${sourceFile} -> ${reference}`);
        const decoded = decodeURIComponent(fragment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const anchor = new RegExp(`(?:id|name)=["']${decoded}["']`, 'i');
        if (!anchor.test(targetHtml)) fail('FRAGMENT_NOT_FOUND', `${sourceFile} -> ${reference}`);
      }
    }
  }

  for (const relative of specification.contract.runtime_allowlist.filter((item) => item.endsWith('.css'))) {
    const css = await readFile(path.join(specification.root, ...relative.split('/')), 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const reference = match[1];
      if (reference.startsWith('data:')) continue;
      const target = routeToArtifact(reference, relative, allowlist);
      if (target && !allowlist.has(target)) fail('CSS_REFERENCE_OUTSIDE_ALLOWLIST', `${relative} -> ${reference}`);
    }
  }
}

function validateProductionInvariants(specification, sourceContent) {
  const runtime = specification.contract.runtime_allowlist;
  const html = runtime.filter((item) => item.endsWith('.html'));
  const canonicalPages = html.filter((item) => item === 'index.html' || item.endsWith('/index.html'));
  if (runtime.length !== 61) fail('RUNTIME_COUNT_INVALID', String(runtime.length));
  if (html.length !== 25 || canonicalPages.length !== 24 || !runtime.includes('404.html')) {
    fail('HTML_TOPOLOGY_INVALID');
  }
  const notFound = sourceContent.get('404.html').toString('utf8');
  if (!/<meta\s+name="robots"\s+content="noindex,nofollow">/i.test(notFound)) fail('404_NOINDEX_MISSING');
  if (!/href="\/"/.test(notFound) || !/href="\/en\/"/.test(notFound)) fail('404_HOME_LINKS_MISSING');
  if (/<(?:script|form)\b/i.test(notFound) || /https?:\/\//i.test(notFound)) fail('404_ACTIVE_OR_REMOTE_CONTENT');

  const headers = sourceContent.get('_headers').toString('utf8');
  for (const required of specification.contract.required_security_headers) {
    if (!headers.includes(required)) fail('SECURITY_HEADER_MISSING', required);
  }
}

export async function verifySource(sourceRoot) {
  const specification = await loadSpecification(sourceRoot);
  const sourceContent = new Map();
  for (const relative of specification.contract.runtime_allowlist) {
    const absolute = path.join(specification.root, ...relative.split('/'));
    await access(absolute, fsConstants.R_OK);
    const info = await stat(absolute);
    if (!info.isFile()) fail('SOURCE_NOT_FILE', relative);
    const bytes = await readFile(absolute);
    const expected = specification.manifestByPath.get(relative);
    if (bytes.length !== expected.bytes) fail('SOURCE_SIZE_MISMATCH', relative);
    if (sha256(bytes) !== expected.sha256) fail('SOURCE_HASH_MISMATCH', relative);
    sourceContent.set(relative, bytes);
  }
  for (const relative of specification.contract.repository_only) {
    await access(path.join(specification.root, ...relative.split('/')), fsConstants.R_OK);
  }
  validateProductionInvariants(specification, sourceContent);
  await validateReferences(specification);
  return specification;
}

export async function verifyDist(sourceRoot, outputRoot) {
  const specification = await loadSpecification(sourceRoot);
  const output = path.resolve(outputRoot);
  const actual = await walkFiles(output);
  const expected = specification.contract.runtime_allowlist;
  if (!sameMembers(expected, actual)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((item) => !actualSet.has(item));
    const extra = actual.filter((item) => !expectedSet.has(item));
    fail('DIST_FILESET_MISMATCH', JSON.stringify({ missing, extra }));
  }
  for (const relative of actual) {
    if (specification.contract.forbidden_dist_files.includes(relative)) fail('FORBIDDEN_DIST_FILE', relative);
    if (specification.contract.forbidden_dist_prefixes.some((prefix) => relative.startsWith(prefix))) {
      fail('FORBIDDEN_DIST_PREFIX', relative);
    }
    const bytes = await readFile(path.join(output, ...relative.split('/')));
    const expectedEntry = specification.manifestByPath.get(relative);
    if (bytes.length !== expectedEntry.bytes || sha256(bytes) !== expectedEntry.sha256) {
      fail('DIST_HASH_MISMATCH', relative);
    }
  }
  return { specification, output, files: actual };
}

export async function buildDist(sourceRoot, outputRoot) {
  const specification = await verifySource(sourceRoot);
  const output = path.resolve(outputRoot);
  if (output === specification.root) fail('OUTPUT_EQUALS_SOURCE');
  try {
    await access(output);
    fail('OUTPUT_ALREADY_EXISTS', output);
  } catch (error) {
    if (error.message?.startsWith('OUTPUT_ALREADY_EXISTS')) throw error;
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(output, { recursive: false });
  for (const relative of specification.contract.runtime_allowlist) {
    const destination = path.join(output, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(specification.root, ...relative.split('/')), destination);
  }
  return verifyDist(specification.root, output);
}
