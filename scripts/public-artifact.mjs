import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CONTRACT_PATH = 'config/public-artifact-contract.json';
export const MANIFEST_PATH = 'config/public-artifact-manifest.json';
const PRIVACY_PROTOTYPE_FILES = ['privacidad/index.html', 'en/privacy/index.html'];
const APPROVED_EXTERNAL_LINKS = [
  'https://github.com/torsion-labs',
  'https://www.linkedin.com/company/torsion-labs/',
  'https://x.com/TorsionLab',
];
const SYNTHETIC_CONTROLLER = 'SYNTHETIC & CONTROLLER <TEST>';
const SYNTHETIC_ADDRESS = 'SYNTHETIC ADDRESS <TEST> 123';
const SYNTHETIC_PRIVACY_EMAIL = 'privacy@example.invalid';
const RELEASE_COPY = {
  'privacidad/index.html': [
    ['<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">'],
    ['<meta name="torsion-publication-state" content="LOCAL_DRAFT_PUBLICATION_NO_GO">', '<meta name="torsion-publication-state" content="PUBLISHED_NOTICE">'],
    ['Candidato local · publicación bloqueada', 'Aviso de privacidad'],
    ['Este candidato permanece fuera de producción hasta verificar identidad, domicilio y recepción de solicitudes.', 'Esta página distingue los datos técnicos del sitio de las solicitudes enviadas al canal de privacidad.'],
    ['Aviso simplificado · candidato local', 'Aviso simplificado'],
    ['Los valores pendientes se insertarán sólo tras la ratificación final de publicación.', 'La fecha de vigencia de este aviso es {{EFFECTIVE_DATE}}.'],
    ['El medio previsto es <strong>{{PRIVACY_EMAIL}}</strong>; aún falta acreditar su revisión operativa antes de activarlo en este aviso.', 'El medio para ejercer derechos es <strong>{{PRIVACY_EMAIL}}</strong>.'],
    ['Aviso integral · candidato local sin vigencia', 'Aviso integral'],
    ['El canal previsto utiliza Google Workspace.', 'El canal de privacidad utiliza Google Workspace.'],
    ['El medio previsto es <strong>{{PRIVACY_EMAIL}}</strong>.', 'El medio de contacto es <strong>{{PRIVACY_EMAIL}}</strong>.'],
    ['El control privado sigue vacío y no acredita todavía una primera revisión real; por ello este candidato no debe publicarse ni anunciar el canal como operativo.', 'La recepción y el seguimiento de solicitudes se documentan en un registro privado con acceso restringido.'],
    ['el medio y la recepción deben verificarse antes de activar el aviso.', 'la recepción se registrará para dar seguimiento a la solicitud.'],
    ['El control de vencimientos está preparado pero no se ha probado con un caso real; esto permanece como bloqueo operativo de publicación.', 'Los vencimientos se controlan desde la fecha de recepción de cada solicitud.'],
    ['Los plazos internos detallados son todavía una política candidata: no se publican como compromiso hasta comprobar su ejecución en buzón, registro privado y respaldos.', 'No se publica aquí un plazo fijo adicional de conservación; cada caso se revisa conforme a su finalidad y obligaciones aplicables.'],
    ['La operación sostenida de estos controles sigue sujeta a verificación.', 'Los controles se revisan como parte de la operación del canal.'],
    ['Candidato local · sin vigencia · no publicar', 'Vigente desde {{EFFECTIVE_DATE}}'],
    ['English draft', 'English'],
  ],
  'en/privacy/index.html': [
    ['<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">'],
    ['<meta name="torsion-publication-state" content="LOCAL_DRAFT_PUBLICATION_NO_GO">', '<meta name="torsion-publication-state" content="PUBLISHED_NOTICE">'],
    ['Local candidate · publication blocked', 'Privacy notice'],
    ["This candidate remains outside production until the controller's identity, address and request handling are verified.", 'This page distinguishes technical website data from requests sent to the privacy channel.'],
    ['Short-form notice · local candidate', 'Short-form notice'],
    ['Pending values will be inserted only after the final publication gate.', 'This notice takes effect on {{EFFECTIVE_DATE}}.'],
    ['The planned address is <strong>{{PRIVACY_EMAIL}}</strong>; its operating review must still be evidenced before this notice activates it.', 'To exercise your rights, write to <strong>{{PRIVACY_EMAIL}}</strong>.'],
    ['Full notice · local candidate without an effective date', 'Full notice'],
    ['The planned channel uses Google Workspace.', 'The privacy channel uses Google Workspace.'],
    ['The planned address is <strong>{{PRIVACY_EMAIL}}</strong>.', 'The contact address is <strong>{{PRIVACY_EMAIL}}</strong>.'],
    ['The private control remains empty and does not yet evidence a first actual review; therefore this candidate must not be published or present the channel as operating.', 'Receipt and follow-up of requests are documented in a restricted private register.'],
    ['the route and receipt must be verified before this notice activates.', 'receipt will be recorded for follow-up.'],
    ['The deadline control is prepared but has not been tested on a real case; this remains an operational publication blocker.', 'Deadlines are tracked from the date each request is received.'],
    ['Detailed internal retention periods remain a candidate policy: they are not published as a commitment until their execution is checked in the mailbox, private register and backups.', 'No additional fixed retention period is stated here; each case is reviewed against its purpose and applicable obligations.'],
    ['Sustained operation of these controls remains subject to verification.', 'These controls are reviewed as part of channel operations.'],
    ['Local candidate · no effective date · do not publish', 'Effective {{EFFECTIVE_DATE}}'],
    ['Candidato en español', 'Español'],
  ],
};

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

function isPrivacyPrototype(relative) {
  return PRIVACY_PROTOTYPE_FILES.includes(relative);
}

function requirePrivacyMode(options) {
  if (options?.syntheticPrivacy === true && options?.releasePrivacy === true) fail('PRIVACY_MODE_CONFLICT');
  if (options?.syntheticPrivacy === true) return;
  if (options?.releasePrivacy !== true) fail('PRIVACY_PROTOTYPE_GATE_CLOSED');
  if (options.publicationGate !== 'AVISO_PUBLICACION_D9_RATIFICADA') fail('PRIVACY_RELEASE_GATE_CLOSED');
  if (options.branch !== 'main') fail('PRIVACY_RELEASE_BRANCH_INVALID');
  const values = options.publicationValues;
  if (!values || typeof values !== 'object') fail('PRIVACY_RELEASE_VALUES_MISSING');
  for (const field of ['controllerName', 'controllerAddress', 'privacyEmail', 'effectiveDate']) {
    if (typeof values[field] !== 'string' || !values[field].trim() || values[field] !== values[field].trim() ||
        /[\r\n\x00-\x1f]/.test(values[field]) || values[field].length > 300) {
      fail('PRIVACY_RELEASE_VALUE_INVALID', field);
    }
  }
  if (values.privacyEmail !== 'privacidad@torsion-labs.com') fail('PRIVACY_RELEASE_VALUE_INVALID', 'privacyEmail');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(values.effectiveDate)
    ? new Date(`${values.effectiveDate}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== values.effectiveDate) {
    fail('PRIVACY_RELEASE_VALUE_INVALID', 'effectiveDate');
  }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function replaceExact(html, oldText, newText) {
  if (html.split(oldText).length !== 2) fail('PRIVACY_RELEASE_COPY_DRIFT');
  return html.replace(oldText, newText);
}

function renderPrivacy(relative, sourceBytes, options) {
  let html = sourceBytes.toString('utf8');
  if (options.releasePrivacy === true) {
    for (const [oldText, newText] of RELEASE_COPY[relative]) html = replaceExact(html, oldText, newText);
  }
  const values = options.releasePrivacy === true ? options.publicationValues : {
    controllerName: SYNTHETIC_CONTROLLER,
    controllerAddress: SYNTHETIC_ADDRESS,
    privacyEmail: SYNTHETIC_PRIVACY_EMAIL,
    effectiveDate: '2000-01-01',
  };
  const tokens = [
    ['{{CONTROLLER_NAME}}', values.controllerName, 1],
    ['{{CONTROLLER_ADDRESS}}', values.controllerAddress, 1],
    ['{{PRIVACY_EMAIL}}', values.privacyEmail, 2],
    ['{{EFFECTIVE_DATE}}', values.effectiveDate, options.releasePrivacy === true ? 2 : 0],
  ];
  for (const [token, value, count] of tokens) {
    if (html.split(token).length !== count + 1) fail('PRIVACY_TEMPLATE_INVALID');
    html = html.replaceAll(token, escapeHtml(value));
  }
  if (/\{\{[A-Z][A-Z0-9_]*\}\}/.test(html)) fail('PRIVACY_TEMPLATE_INVALID');
  if (options.releasePrivacy === true && /candidate|candidato|publication blocked|publicaci[oó]n bloqueada|do not publish|no publicar|LOCAL_DRAFT_PUBLICATION_NO_GO/i.test(html)) {
    fail('PRIVACY_RELEASE_COPY_UNSAFE');
  }
  return Buffer.from(html, 'utf8');
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
  if (!Array.isArray(contract.external_navigation_allowlist) ||
      !sameMembers(contract.external_navigation_allowlist, APPROVED_EXTERNAL_LINKS)) {
    fail('EXTERNAL_NAVIGATION_ALLOWLIST_INVALID');
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

function routeToArtifact(raw, sourceFile, allowlist, externalNavigation, attribute = 'href', tagName = '') {
  const withoutFragment = raw.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  if (!withoutQuery) return sourceFile;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(withoutQuery)) return null;

  let pathname;
  if (/^https?:\/\//i.test(withoutQuery)) {
    const url = new URL(withoutQuery);
    if (!['torsion-labs.com', 'www.torsion-labs.com', 'torsion-labs-web.pages.dev'].includes(url.hostname)) {
      if (tagName === 'a' && attribute === 'href' && externalNavigation.has(raw)) return null;
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
  const externalNavigation = new Set(specification.contract.external_navigation_allowlist);
  const htmlByPath = new Map();
  for (const relative of specification.contract.runtime_allowlist.filter((item) => item.endsWith('.html'))) {
    htmlByPath.set(relative, await readFile(path.join(specification.root, ...relative.split('/')), 'utf8'));
  }

  for (const [sourceFile, html] of htmlByPath) {
    for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
      const tagName = tag[1].toLowerCase();
      for (const [, attribute, reference] of tag[0].matchAll(/\b(href|src)\s*=\s*["']([^"']+)["']/gi)) {
        const target = routeToArtifact(reference, sourceFile, allowlist, externalNavigation, attribute.toLowerCase(), tagName);
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
    for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
      if (!externalNavigation.has(match[1])) continue;
      if (!/\btarget\s*=\s*["']_blank["']/i.test(match[0]) ||
          !/\brel\s*=\s*["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']/i.test(match[0])) {
        fail('EXTERNAL_LINK_REL_INVALID', `${sourceFile} -> ${match[1]}`);
      }
    }
  }

  for (const relative of specification.contract.runtime_allowlist.filter((item) => item.endsWith('.css'))) {
    const css = await readFile(path.join(specification.root, ...relative.split('/')), 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const reference = match[1];
      if (reference.startsWith('data:')) continue;
      const target = routeToArtifact(reference, relative, allowlist, externalNavigation, 'src');
      if (target && !allowlist.has(target)) fail('CSS_REFERENCE_OUTSIDE_ALLOWLIST', `${relative} -> ${reference}`);
    }
  }
}

function validateProductionInvariants(specification, sourceContent) {
  const runtime = specification.contract.runtime_allowlist;
  const html = runtime.filter((item) => item.endsWith('.html'));
  const canonicalPages = html.filter((item) => item === 'index.html' || item.endsWith('/index.html'));
  if (runtime.length !== 64) fail('RUNTIME_COUNT_INVALID', String(runtime.length));
  if (html.length !== 27 || canonicalPages.length !== 26 || !runtime.includes('404.html')) {
    fail('HTML_TOPOLOGY_INVALID');
  }
  for (const relative of PRIVACY_PROTOTYPE_FILES) {
    if (!runtime.includes(relative)) fail('PRIVACY_TEMPLATE_MISSING', relative);
    const page = sourceContent.get(relative).toString('utf8');
    if (!/<meta\s+name="robots"\s+content="noindex,nofollow">/i.test(page) ||
        !page.includes('LOCAL_DRAFT_PUBLICATION_NO_GO') ||
        /<(?:script|form)\b/i.test(page)) fail('PRIVACY_TEMPLATE_INVALID', relative);
    renderPrivacy(relative, sourceContent.get(relative), { syntheticPrivacy: true });
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

export async function verifyDist(sourceRoot, outputRoot, options) {
  const specification = await loadSpecification(sourceRoot);
  requirePrivacyMode(options);
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
    const expectedBytes = isPrivacyPrototype(relative)
      ? renderPrivacy(relative, await readFile(path.join(specification.root, ...relative.split('/'))), options)
      : null;
    const expectedLength = expectedBytes?.length ?? expectedEntry.bytes;
    const expectedHash = expectedBytes ? sha256(expectedBytes) : expectedEntry.sha256;
    if (bytes.length !== expectedLength || sha256(bytes) !== expectedHash) {
      fail('DIST_HASH_MISMATCH', relative);
    }
  }
  return { specification, output, files: actual };
}

export async function buildDist(sourceRoot, outputRoot, options) {
  const specification = await verifySource(sourceRoot);
  requirePrivacyMode(options);
  const renderedPrivacy = new Map();
  for (const relative of PRIVACY_PROTOTYPE_FILES) {
    const sourceBytes = await readFile(path.join(specification.root, ...relative.split('/')));
    renderedPrivacy.set(relative, renderPrivacy(relative, sourceBytes, options));
  }
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
    if (isPrivacyPrototype(relative)) {
      await writeFile(destination, renderedPrivacy.get(relative));
    } else await copyFile(path.join(specification.root, ...relative.split('/')), destination);
  }
  return verifyDist(specification.root, output, options);
}
