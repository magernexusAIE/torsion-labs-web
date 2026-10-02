#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, cp, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildDist, verifyDist, verifySource } from './public-artifact.mjs';

const source = path.resolve(process.argv[2] ?? process.cwd());
const temp = await mkdtemp(path.join(os.tmpdir(), 'torsion-web-artifact-test-'));
const results = [];
const synthetic = { syntheticPrivacy: true };
const release = {
  releasePrivacy: true,
  publicationGate: 'AVISO_PUBLICACION_D9_RATIFICADA',
  branch: 'main',
  publicationValues: {
    controllerName: 'SYNTHETIC & CONTROLLER <TEST>',
    controllerAddress: 'SYNTHETIC ADDRESS <TEST> 123',
    privacyEmail: 'privacidad@torsion-labs.com',
    effectiveDate: '2000-01-01',
  },
};

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
  const ordinary = path.join(temp, 'ordinary');
  await expectFail('reject_ordinary_build', 'PRIVACY_PROTOTYPE_GATE_CLOSED', () => buildDist(source, ordinary));
  await expectPass('ordinary_build_creates_no_output', async () => {
    try {
      await access(ordinary);
      throw new Error('UNEXPECTED_ORDINARY_OUTPUT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
  await expectPass('deterministic_build', () => buildDist(source, baseline, synthetic));
  await expectFail('reject_ordinary_verify', 'PRIVACY_PROTOTYPE_GATE_CLOSED', () => verifyDist(source, baseline));
  await expectPass('exact_dist', () => verifyDist(source, baseline, synthetic));
  await expectPass('synthetic_privacy_render', async () => {
    for (const relative of ['privacidad/index.html', 'en/privacy/index.html']) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (!html.includes('SYNTHETIC &amp; CONTROLLER &lt;TEST&gt;') ||
          !html.includes('SYNTHETIC ADDRESS &lt;TEST&gt; 123') ||
          !html.includes('privacy@example.invalid') ||
          html.includes('{{CONTROLLER_') || html.includes('{{PRIVACY_EMAIL}}')) {
        throw new Error(`SYNTHETIC_RENDER_INVALID:${relative}`);
      }
    }
  });
  const releaseOutput = path.join(temp, 'release');
  await expectFail('reject_release_without_gate', 'PRIVACY_RELEASE_GATE_CLOSED', () =>
    buildDist(source, releaseOutput, { ...release, publicationGate: undefined }));
  await expectFail('reject_release_on_preview', 'PRIVACY_RELEASE_BRANCH_INVALID', () =>
    buildDist(source, releaseOutput, { ...release, branch: 'codex/preview' }));
  await expectFail('reject_release_without_identity', 'PRIVACY_RELEASE_VALUE_INVALID', () =>
    buildDist(source, releaseOutput, { ...release, publicationValues: { ...release.publicationValues, controllerAddress: '' } }));
  await expectFail('reject_invalid_effective_date', 'PRIVACY_RELEASE_VALUE_INVALID', () =>
    buildDist(source, releaseOutput, { ...release, publicationValues: { ...release.publicationValues, effectiveDate: '2026-02-31' } }));
  await expectPass('rejected_release_creates_no_output', async () => {
    try {
      await access(releaseOutput);
      throw new Error('UNEXPECTED_RELEASE_OUTPUT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
  await expectPass('release_build_with_fake_identity', () => buildDist(source, releaseOutput, release));
  await expectPass('release_dist_integrity', () => verifyDist(source, releaseOutput, release));
  await expectPass('release_copy_no_draft_markers', async () => {
    for (const relative of ['privacidad/index.html', 'en/privacy/index.html']) {
      const html = await readFile(path.join(releaseOutput, ...relative.split('/')), 'utf8');
      if (!html.includes('SYNTHETIC &amp; CONTROLLER &lt;TEST&gt;') ||
          !html.includes('SYNTHETIC ADDRESS &lt;TEST&gt; 123') ||
          !html.includes('privacidad@torsion-labs.com') ||
          !html.includes('2000-01-01') ||
          !html.includes('content="index,follow"') ||
          /\{\{|candidate|candidato|no publicar|do not publish|PUBLICATION_NO_GO/i.test(html)) {
        throw new Error(`RELEASE_RENDER_INVALID:${relative}`);
      }
    }
  });
  const releaseDrift = path.join(temp, 'release-copy-drift');
  await copyGovernedSource(releaseDrift);
  const driftPage = path.join(releaseDrift, 'privacidad', 'index.html');
  await writeFile(driftPage, (await readFile(driftPage, 'utf8')).replace('Candidato local · publicación bloqueada', 'Candidato local · publicación aún bloqueada'));
  await resealFile(releaseDrift, 'privacidad/index.html');
  const driftOutput = path.join(temp, 'release-drift-output');
  await expectFail('reject_release_copy_drift', 'PRIVACY_RELEASE_COPY_DRIFT', () =>
    buildDist(releaseDrift, driftOutput, release));
  await expectPass('release_copy_drift_creates_no_output', async () => {
    try {
      await access(driftOutput);
      throw new Error('UNEXPECTED_DRIFT_OUTPUT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
  await expectPass('approved_profiles_and_notice_links_bilingual', async () => {
    const profiles = [
      'https://github.com/torsion-labs',
      'https://www.linkedin.com/company/torsion-labs/',
      'https://x.com/TorsionLab',
    ];
    for (const [relative, noticeRoute] of [
      ['index.html', '/privacidad/'],
      ['en/index.html', '/en/privacy/'],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (!profiles.every((url) => html.includes(`href="${url}"`)) ||
          !html.includes(`href="${noticeRoute}"`)) {
        throw new Error(`PUBLIC_FOOTER_INCOMPLETE:${relative}`);
      }
    }
  });

  await expectPass('accessible_social_icons_bilingual', async () => {
    const profiles = [
      ['GitHub', 'https://github.com/torsion-labs'],
      ['LinkedIn', 'https://www.linkedin.com/company/torsion-labs/'],
      ['X', 'https://x.com/TorsionLab'],
    ];
    for (const relative of ['index.html', 'en/index.html', 'privacidad/index.html', 'en/privacy/index.html']) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const label = relative.startsWith('en/') ? 'Follow Torsion' : 'Seguir a Torsión';
      if (!html.includes(`<nav class="social-nav" aria-label="${label}">`) ||
          !html.includes(`<span class="social-heading">${label}</span>`)) {
        throw new Error(`SOCIAL_NAV_MISSING:${relative}`);
      }
      for (const [name, url] of profiles) {
        const iconAnchor = `<a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="`;
        if (!html.includes(iconAnchor)) throw new Error(`SOCIAL_ICON_MISSING:${relative}:${name}`);
      }
    }
  });

  const extra = path.join(temp, 'extra');
  await cp(baseline, extra, { recursive: true });
  await writeFile(path.join(extra, 'README.md'), 'not runtime\n');
  await expectFail('reject_extra_file', 'DIST_FILESET_MISMATCH', () => verifyDist(source, extra, synthetic));

  const missing = path.join(temp, 'missing');
  await cp(baseline, missing, { recursive: true });
  await unlink(path.join(missing, '404.html'));
  await expectFail('reject_missing_file', 'DIST_FILESET_MISMATCH', () => verifyDist(source, missing, synthetic));

  const tampered = path.join(temp, 'tampered');
  await cp(baseline, tampered, { recursive: true });
  await writeFile(path.join(tampered, 'index.html'), 'tampered\n');
  await expectFail('reject_tampered_bytes', 'DIST_HASH_MISMATCH', () => verifyDist(source, tampered, synthetic));

  const privacyTampered = path.join(temp, 'privacy-tampered');
  await cp(baseline, privacyTampered, { recursive: true });
  await writeFile(path.join(privacyTampered, 'privacidad', 'index.html'), 'tampered\n');
  await expectFail('reject_tampered_privacy', 'DIST_HASH_MISMATCH', () => verifyDist(source, privacyTampered, synthetic));

  const nested = path.join(temp, 'nested-extra');
  await cp(baseline, nested, { recursive: true });
  await mkdir(path.join(nested, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(nested, '.github', 'workflows', 'ci.yml'), 'forbidden\n');
  await expectFail('reject_repository_metadata', 'DIST_FILESET_MISMATCH', () => verifyDist(source, nested, synthetic));

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

  const privacyNoindex = path.join(temp, 'privacy-noindex');
  await copyGovernedSource(privacyNoindex);
  const privacyPage = path.join(privacyNoindex, 'privacidad', 'index.html');
  await writeFile(privacyPage, (await readFile(privacyPage, 'utf8')).replace('noindex,nofollow', 'index,follow'));
  await resealFile(privacyNoindex, 'privacidad/index.html');
  await expectFail('reject_indexable_privacy', 'PRIVACY_TEMPLATE_INVALID', () => verifySource(privacyNoindex));

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

  const unapprovedExternal = path.join(temp, 'unapproved-external');
  await copyGovernedSource(unapprovedExternal);
  const unapprovedIndex = path.join(unapprovedExternal, 'index.html');
  await writeFile(unapprovedIndex, (await readFile(unapprovedIndex, 'utf8'))
    .replace('https://github.com/torsion-labs', 'https://github.com/not-torsion'));
  await resealFile(unapprovedExternal, 'index.html');
  await expectFail('reject_unapproved_external_link', 'EXTERNAL_REFERENCE_FORBIDDEN', () => verifySource(unapprovedExternal));

  const externalAsAsset = path.join(temp, 'external-as-asset');
  await copyGovernedSource(externalAsAsset);
  const externalAssetIndex = path.join(externalAsAsset, 'index.html');
  await writeFile(externalAssetIndex, (await readFile(externalAssetIndex, 'utf8'))
    .replace('src="/assets/logo-torsion.svg"', 'src="https://github.com/torsion-labs"'));
  await resealFile(externalAsAsset, 'index.html');
  await expectFail('reject_external_asset', 'EXTERNAL_REFERENCE_FORBIDDEN', () => verifySource(externalAsAsset));

  const externalAsStylesheet = path.join(temp, 'external-as-stylesheet');
  await copyGovernedSource(externalAsStylesheet);
  const externalStylesheetIndex = path.join(externalAsStylesheet, 'index.html');
  await writeFile(externalStylesheetIndex, (await readFile(externalStylesheetIndex, 'utf8'))
    .replace('href="/assets/home-v4.css"', 'href="https://github.com/torsion-labs"'));
  await resealFile(externalAsStylesheet, 'index.html');
  await expectFail('reject_external_stylesheet', 'EXTERNAL_REFERENCE_FORBIDDEN', () => verifySource(externalAsStylesheet));

  const unsafeExternal = path.join(temp, 'unsafe-external');
  await copyGovernedSource(unsafeExternal);
  const unsafeIndex = path.join(unsafeExternal, 'index.html');
  await writeFile(unsafeIndex, (await readFile(unsafeIndex, 'utf8'))
    .replace('target="_blank" rel="noopener noreferrer" aria-label="GitHub"', 'target="_blank" aria-label="GitHub"'));
  await resealFile(unsafeExternal, 'index.html');
  await expectFail('reject_external_without_safe_rel', 'EXTERNAL_LINK_REL_INVALID', () => verifySource(unsafeExternal));

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
