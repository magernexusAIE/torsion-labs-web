#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, cp, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runInNewContext } from 'node:vm';
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

function readSeoIdentity(html) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const blocks = [...head.matchAll(/<script\b([^>]*\btype="application\/ld\+json"[^>]*)>([\s\S]*?)<\/script>/gi)];
  if (blocks.length !== 1) throw new Error('SEO_IDENTITY_BLOCK_INVALID');
  if (!/^\s*type="application\/ld\+json"\s*$/i.test(blocks[0][1])) {
    throw new Error('SEO_IDENTITY_ACTIVE_ATTRIBUTES');
  }
  return JSON.parse(blocks[0][2]);
}

function validateSeoIdentity(data, description, profiles) {
  const keys = ['@context', '@type', '@id', 'name', 'alternateName', 'url', 'logo', 'description', 'sameAs'];
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length !== keys.length || Object.keys(data).some(key => !keys.includes(key)) ||
      data['@context'] !== 'https://schema.org' || data['@type'] !== 'Organization' ||
      data['@id'] !== 'https://torsion-labs.com/#organization' || data.name !== 'Torsión Labs' ||
      data.url !== 'https://torsion-labs.com/' ||
      data.logo !== 'https://torsion-labs.com/assets/logo-torsion.svg' || data.description !== description ||
      JSON.stringify(data.alternateName) !== JSON.stringify(['Torsión', 'Torsion Labs']) ||
      !Array.isArray(data.sameAs) || data.sameAs.length !== profiles.length ||
      new Set(data.sameAs).size !== profiles.length || !profiles.every(profile => data.sameAs.includes(profile))) {
    throw new Error('SEO_IDENTITY_INVALID');
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

  await expectPass('accessible_social_icons_all_pages', async () => {
    const profiles = [
      ['GitHub', 'https://github.com/torsion-labs'],
      ['LinkedIn', 'https://www.linkedin.com/company/torsion-labs/'],
      ['X', 'https://x.com/TorsionLab'],
    ];
    const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
    const pages = contract.runtime_allowlist.filter((relative) => relative.endsWith('.html'));
    const original = new Set(['index.html', 'en/index.html', 'privacidad/index.html', 'en/privacy/index.html']);
    if (pages.length !== 27) throw new Error(`SOCIAL_PAGE_COUNT_INVALID:${pages.length}`);
    const css = await readFile(path.join(baseline, 'assets/footer-links.css'), 'utf8');
    if (!/\.social-links svg\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/s.test(css) ||
        !/\.social-nav--large \.social-links svg\s*\{[^}]*width:\s*24\.2px;[^}]*height:\s*24\.2px;/s.test(css)) {
      throw new Error('SOCIAL_ICON_SIZE_INVALID');
    }
    for (const relative of pages) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const label = relative.startsWith('en/') ? 'Follow Torsion' : 'Seguir a Torsión';
      const navClass = original.has(relative) ? 'social-nav' : 'social-nav social-nav--large';
      const footer = html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] ?? '';
      if (!html.includes(`<nav class="${navClass}" aria-label="${label}">`) ||
          !html.includes(`<span class="social-heading">${label}</span>`) ||
          !html.includes('href="/assets/footer-links.css?v=refresh-theme-1"') ||
          (footer.match(/<nav class="social-nav/g) ?? []).length !== 1) {
        throw new Error(`SOCIAL_NAV_MISSING:${relative}`);
      }
      for (const [name, url] of profiles) {
        const iconAnchor = `<a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="`;
        if (!footer.includes(iconAnchor) || footer.split(`href="${url}"`).length !== 2) {
          throw new Error(`SOCIAL_ICON_MISSING:${relative}:${name}`);
        }
      }
    }
  });

  await expectPass('bilingual_footer_navigation_all_pages', async () => {
    const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
    const pages = contract.runtime_allowlist.filter((relative) => relative.endsWith('.html'));
    const css = await readFile(path.join(baseline, 'assets/footer-links.css'), 'utf8');
    if (pages.length !== 27 ||
        !css.includes('grid-template-columns: repeat(3, minmax(0, 1fr));') ||
        !css.includes('flex: 0 0 100%;') ||
        !/footer\.site-footer \.footer-nav\s*\{[^}]*height:\s*auto;/.test(css) ||
        !/footer\.site-footer \.social-nav\s*\{[^}]*height:\s*auto;/.test(css) ||
        !css.includes('footer.site-footer--light .footer-nav-title') ||
        !css.includes('@media (max-width: 420px)')) {
      throw new Error('FOOTER_NAV_STYLE_INVALID');
    }
    const languages = {
      es: {
        label: 'Navegación del sitio',
        groups: ['Torsión', 'Explorar', 'Información'],
        links: [
          ['Inicio', '/'], ['Postura', '/postura/'], ['Ciencia', '/ciencia/'],
          ['Portafolio', '/portafolio/'], ['Evidencia', '/evidencia/'],
          ['Contacto', '/contacto/'], ['Aviso de privacidad', '/privacidad/'],
        ],
        contact: '/contacto/',
        privacy: '/privacidad/',
      },
      en: {
        label: 'Site navigation',
        groups: ['Torsion', 'Explore', 'Information'],
        links: [
          ['Home', '/en/'], ['Posture', '/en/posture/'], ['Science', '/en/science/'],
          ['Portfolio', '/en/portfolio/'], ['Evidence', '/en/evidence/'],
          ['Contact', '/en/contact/'], ['Privacy notice', '/en/privacy/'],
        ],
        contact: '/en/contact/',
        privacy: '/en/privacy/',
      },
    };
    for (const relative of pages) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const footer = html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] ?? '';
      const nav = footer.match(/<nav class="footer-nav"[\s\S]*?<\/nav>/i)?.[0] ?? '';
      const expected = relative.startsWith('en/') ? languages.en : languages.es;
      if ((footer.match(/<nav class="footer-nav"/g) ?? []).length !== 1 ||
          !nav.includes('aria-label="' + expected.label + '"') ||
          (nav.match(/<div class="footer-nav-group">/g) ?? []).length !== 3 ||
          (nav.match(/<a href=/g) ?? []).length !== 7 ||
          !html.includes('href="/assets/footer-links.css?v=refresh-theme-1"') ||
          footer.indexOf('class="footer-nav"') > footer.indexOf('class="social-nav')) {
        throw new Error(`FOOTER_NAV_STRUCTURE_INVALID:${relative}`);
      }
      for (const heading of expected.groups) {
        if (!nav.includes('<h2 class="footer-nav-title">' + heading + '</h2>')) {
          throw new Error(`FOOTER_NAV_GROUP_MISSING:${relative}:${heading}`);
        }
      }
      for (const [label, route] of expected.links) {
        if (!nav.includes('<a href="' + route + '">' + label + '</a>') ||
            !contract.runtime_allowlist.includes(route.slice(1) + 'index.html') && route !== '/') {
          throw new Error(`FOOTER_NAV_LINK_INVALID:${relative}:${route}`);
        }
      }
      for (const route of [expected.contact, expected.privacy]) {
        if (footer.split('href="' + route + '"').length !== 2) {
          throw new Error(`FOOTER_NAV_DUPLICATE_LINK:${relative}:${route}`);
        }
      }
    }
  });

  await expectPass('refresh_theme_all_public_pages', async () => {
    const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
    const pages = contract.runtime_allowlist.filter((relative) => relative.endsWith('.html'));
    const activeCss = new Set(['home-v4.css', 'home-v4-finish.css', 'science-v4.css', 'portfolio-v4.css', 'proyecto.css', 'footer-links.css']);
    const darkPages = new Set(['index.html', 'en/index.html', '404.html', 'ciencia/index.html', 'en/science/index.html']);
    if (pages.length !== 27) throw new Error('REFRESH_PAGE_COUNT_INVALID');
    for (const relative of pages) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const styles = [...html.matchAll(/href="\/assets\/([^"/?]+\.css)([^"\s]*)"/g)];
      if (!styles.some((entry) => entry[1] === 'footer-links.css') ||
          styles.some((entry) => activeCss.has(entry[1]) && entry[2] !== '?v=refresh-theme-1')) {
        throw new Error('REFRESH_CSS_VERSION_INVALID:' + relative);
      }
      const theme = html.match(/<meta name="theme-color" content="([^"\s]+)"/);
      if (theme && theme[1].toLowerCase() !== (darkPages.has(relative) ? '#11191c' : '#f4f1e9')) {
        throw new Error('REFRESH_THEME_META_INVALID:' + relative);
      }
    }
  });

  await expectPass('refresh_palette_opaque_contrast_pairs', async () => {
    const activeCss = ['home-v4.css', 'home-v4-finish.css', 'science-v4.css', 'portfolio-v4.css', 'proyecto.css', 'footer-links.css'];
    const css = (await Promise.all(activeCss.map((relative) => readFile(path.join(baseline, 'assets', relative), 'utf8')))).join('\n');
    if (/#(?:ceff49|caff3d|d8ff72)\b|rgba\(202,255,61,/i.test(css) ||
        !['#11191c', '#f4f1e9', '#62c9a9', '#146b58'].every((value) => css.toLowerCase().includes(value))) {
      throw new Error('REFRESH_PALETTE_INVALID');
    }
    function luminance(hex) {
      const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
        .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }
    for (const [foreground, background] of [
      ['#f4f1e9', '#11191c'], ['#62c9a9', '#11191c'], ['#b3c1bc', '#11191c'],
      ['#146b58', '#f4f1e9'], ['#172b2b', '#f4f1e9'], ['#566862', '#f4f1e9'],
    ]) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      if ((values[0] + .05) / (values[1] + .05) < 4.5) throw new Error('REFRESH_CONTRAST_PAIR_INVALID');
    }
    // Opaque palette pairs only: not a rendered or whole-site accessibility certification.
  });

  await expectPass('preserve_six_project_color_identities', async () => {
    const project = await readFile(path.join(baseline, 'assets', 'proyecto.css'), 'utf8');
    for (const [theme, color] of [
      ['rotor', '#E8722A'], ['energia', '#1FA45C'], ['seguridad', '#2E7CD6'],
      ['biomedicina', '#C99700'], ['percepcion', '#DB4A4A'], ['educacion', '#8B5CF6'],
    ]) {
      if (!project.includes('body.theme-' + theme + '{--c:' + color + '}')) {
        throw new Error('PROJECT_COLOR_IDENTITY_CHANGED:' + theme);
      }
    }
    const portfolio = await readFile(path.join(baseline, 'assets', 'portfolio-v4.css'), 'utf8');
    for (const [theme, color] of [
      ['orange', '#c55c24'], ['green', '#347b45'], ['blue', '#28658f'],
      ['yellow', '#967b00'], ['red', '#a83f48'], ['purple', '#704aa0'],
    ]) {
      if (!portfolio.includes('.' + theme + ' b{color:' + color + '}')) {
        throw new Error('PORTFOLIO_COLOR_IDENTITY_CHANGED:' + theme);
      }
    }
  });

  await expectPass('verde_synthetic_status_bilingual', async () => {
    for (const relative of [
      'proyectos/energia/index.html', 'en/proyectos/energia/index.html',
      'portafolio/index.html', 'en/portfolio/index.html', 'evidencia/index.html', 'en/evidence/index.html',
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const english = relative.startsWith('en/');
      const expected = english
        ? ['53/53', 'datetime="2026-10-05"', 'synthetic', 'agentic matrix is undergoing architectural review and optimization', 'physical', 'instruments', 'reference']
        : ['53/53', 'datetime="2026-10-05"', 'sintétic', 'matriz agéntica está en revisión y optimización de su arquitectura', 'física', 'instrumentos', 'referencia'];
      if (!expected.every((value) => html.includes(value)) ||
          /mejora observada|observed improvement/i.test(html)) {
        throw new Error('VERDE_SYNTHETIC_SCOPE_INVALID:' + relative);
      }
    }
  });

  await expectPass('internal_matrix_pause_not_disclosed_on_public_pages', async () => {
    const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
    const pages = contract.runtime_allowlist.filter(relative => relative.endsWith('.html'));
    if (pages.length !== 27) throw new Error('PUBLIC_PAGE_COUNT_INVALID');
    for (const relative of pages) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      if (/(?:matriz(?: ag[ée]ntica)?|(?:agentic )?matrix)[^.?!]{0,100}(?:pausad[ao]s?|paused)/i.test(text)) {
        throw new Error('INTERNAL_MATRIX_STATE_DISCLOSED:' + relative);
      }
    }
  });

  await expectPass('verde_semantic_closure_preserves_historical_limits', async () => {
    for (const [relative, markers, obsolete] of [
      ['proyectos/energia/index.html', ['Baseline Semana 06', '10 de agosto', 'software local', 'no valida físicamente', '~16%', 'no una medición de panel'], 'La semántica de integración permanece abierta'],
      ['en/proyectos/energia/index.html', ['Baseline Week 06', 'August 10', 'local software', 'does not physically validate', '~16%', 'not a panel or edge-hardware measurement'], 'Integration semantics remain open'],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (!markers.every((value) => html.includes(value)) || html.includes(obsolete)) {
        throw new Error('VERDE_HISTORICAL_LIMIT_CHANGED:' + relative);
      }
    }
    for (const [relative, historic] of [
      ['evidencia/index.html', 'El escenario a 35 °C difiere ~16% de la fórmula anterior. No representa medición sobre panel o nodo.'],
      ['en/evidence/index.html', 'The 35 °C scenario differs by ~16% from the previous formula. It is not a panel or node measurement.'],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (!html.includes(historic) || !html.includes('datetime="2026-10-05"')) {
        throw new Error('VERDE_HISTORICAL_EVIDENCE_CHANGED:' + relative);
      }
    }
  });

  await expectPass('almanaque_bilingual_proposal_preserves_education_limits', async () => {
    for (const [relative, headingId, markers, existingMarkers] of [
      ['proyectos/educacion/index.html', 'almanaque-titulo', [
        'ALMANAQUE · Historia del conocimiento', 'aplicación educativa propuesta',
        'líneas de tiempo y grafos', 'una fecha aproximada no se presenta como',
        'una ausencia documental no se rellena como hecho',
        'Su corpus todavía no está integrado en la aplicación educativa ni constituye contenido pedagógico validado.',
        'a revisión histórica y pedagógica antes de cualquier incorporación educativa.',
      ], ['cliente Android y motor offline-first', 'dos recorridos de aprendizaje',
        'Hoy no se ofrece APK ni enlace', 'no acredita cobertura en 22 lenguas']],
      ['en/proyectos/educacion/index.html', 'almanaque-title', [
        'ALMANAQUE · History of knowledge', 'proposed educational application',
        'historical sources through timelines and graphs', 'an approximate date is not presented as',
        'a documentary gap is not filled in as fact',
        'Its corpus is not yet integrated into the educational application and is not validated pedagogical content.',
        'to historical and pedagogical review before any educational incorporation.',
      ], ['an Android client and offline-first engine', 'two learning journeys',
        'No APK or installation link is offered', 'does not establish coverage in 22 languages']],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const sections = [...html.matchAll(/<section\b[^>]*\bid="almanaque"[^>]*>[\s\S]*?<\/section>/g)];
      const section = sections[0]?.[0] ?? '';
      if (sections.length !== 1 || !section.includes('aria-labelledby="' + headingId + '"') ||
          !section.includes('<h2 id="' + headingId + '">') ||
          !markers.every((value) => section.includes(value)) ||
          !existingMarkers.every((value) => html.includes(value)) ||
          /<a\b|<script\b|<iframe\b|<form\b|<img\b/i.test(section)) {
        throw new Error('ALMANAQUE_EDUCATIONAL_PROPOSAL_SCOPE_INVALID:' + relative);
      }
    }
  });

  await expectPass('modern_live_deck_bilingual_clear_media_and_caption', async () => {
    const css = await readFile(path.join(source, 'assets', 'home-v4-finish.css'), 'utf8');
    if (!css.includes('.live-visual {') || !css.includes('.live-caption {') ||
        !css.includes('object-fit: contain;') || css.includes('.live-panel::after') ||
        css.includes('.live-motion {') || css.includes('.live-grid {')) {
      throw new Error('MODERN_DECK_LAYOUT_INVALID');
    }
    for (const relative of ['index.html', 'en/index.html']) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const deck = html.slice(html.indexOf('<section class="live-deck"'), html.indexOf('<div class="domain-selector">'));
      if ((deck.match(/class="live-visual"/g) ?? []).length !== 2 ||
          (deck.match(/class="live-caption"/g) ?? []).length !== 2 ||
          (deck.match(/<video muted loop playsinline preload="metadata"/g) ?? []).length !== 2 ||
          /autoplay|live-motion|live-grid/.test(deck)) throw new Error('MODERN_DECK_MARKUP_INVALID:' + relative);
      for (const kind of ['field', 'network']) {
        if (!deck.includes('/assets/live/torsion-' + kind + '-v2.mp4') ||
            !deck.includes('/assets/live/torsion-' + kind + '-v2.webp') ||
            deck.includes('/assets/live/torsion-' + kind + '-v1.')) {
          throw new Error('MODERN_DECK_MEDIA_REFERENCE_INVALID:' + relative);
        }
      }
      const limits = relative.startsWith('en/')
        ? ['This is not a physical measurement.', 'This does not represent real traffic.', 'not live telemetry']
        : ['No representa medición física.', 'No representa tráfico real.', 'no es telemetría en vivo'];
      if (!limits.every(value => deck.includes(value))) throw new Error('MODERN_DECK_LIMITS_MISSING');
      const tabOrder = [...deck.matchAll(/data-live-tab="([^"]+)"/g)].map(match => match[1]);
      const panelOrder = [...deck.matchAll(/data-live-panel="([^"]+)"/g)].map(match => match[1]);
      if (tabOrder.join(',') !== 'network,field' || panelOrder.join(',') !== 'network,field') {
        throw new Error('MODERN_DECK_SWAPPED_ORDER_INVALID:' + relative);
      }
      for (const [kind, number, rate, hidden] of [['network', '01', '0.85', false], ['field', '02', '0.75', true]]) {
        const tab = deck.match(new RegExp('<button[^>]*data-live-tab="' + kind + '"[^>]*>[\\s\\S]*?</button>'))?.[0];
        const panel = deck.match(new RegExp('<article[^>]*data-live-panel="' + kind + '"[^>]*>[\\s\\S]*?</article>'))?.[0];
        const heading = relative.startsWith('en/')
          ? (kind === 'network' ? 'Federated network' : 'Torsional field')
          : (kind === 'network' ? 'Red federada' : 'Campo torsional');
        if (!tab || !panel || !tab.includes('<span>' + number + '</span>') ||
            !tab.includes('aria-selected="' + String(!hidden) + '"') ||
            !tab.includes('tabindex="' + (hidden ? '-1' : '0') + '"') ||
            / hidden>/.test(panel.split('\n')[0]) !== hidden ||
            !panel.includes('data-playback-rate="' + rate + '"') ||
            !panel.includes('/assets/live/torsion-' + kind + '-v2.mp4') ||
            !panel.includes('/assets/live/torsion-' + kind + '-v2.webp') ||
            !panel.includes('<h3>' + heading + '</h3>')) {
          throw new Error('MODERN_DECK_SCENE_RATE_OR_COPY_INVALID:' + relative + ':' + kind);
        }
      }
    }
  });

  await expectPass('modern_live_media_video_only_fast_start_and_webp_posters', async () => {
    function boxes(bytes, start = 0, end = bytes.length, found = []) {
      for (let cursor = start; cursor < end;) {
        if (cursor + 8 > end) throw new Error('MP4_BOX_TRUNCATED');
        let size = bytes.readUInt32BE(cursor), header = 8;
        const type = bytes.toString('ascii', cursor + 4, cursor + 8);
        if (size === 1) { size = Number(bytes.readBigUInt64BE(cursor + 8)); header = 16; }
        if (size === 0) size = end - cursor;
        if (!Number.isSafeInteger(size) || size < header || cursor + size > end) throw new Error('MP4_BOX_INVALID');
        found.push({ type, start: cursor, payload: cursor + header, end: cursor + size });
        if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) boxes(bytes, cursor + header, cursor + size, found);
        cursor += size;
      }
      return found;
    }
    for (const kind of ['field', 'network']) {
      const bytes = await readFile(path.join(baseline, 'assets', 'live', 'torsion-' + kind + '-v2.mp4'));
      const parsed = boxes(bytes);
      const handlers = parsed.filter(box => box.type === 'hdlr').map(box => bytes.toString('ascii', box.payload + 8, box.payload + 12));
      const track = parsed.find(box => box.type === 'tkhd');
      const moov = parsed.find(box => box.type === 'moov'), mdat = parsed.find(box => box.type === 'mdat');
      if (handlers.length !== 1 || handlers[0] !== 'vide' || !track || !moov || !mdat ||
          moov.start > mdat.start || bytes.length > 4 * 1024 * 1024 ||
          bytes.readUInt32BE(track.end - 8) / 65536 !== 1280 ||
          bytes.readUInt32BE(track.end - 4) / 65536 !== 720) throw new Error('MODERN_VIDEO_INVALID:' + kind);
      const poster = await readFile(path.join(baseline, 'assets', 'live', 'torsion-' + kind + '-v2.webp'));
      if (poster.toString('ascii', 0, 4) !== 'RIFF' || poster.toString('ascii', 8, 12) !== 'WEBP') {
        throw new Error('MODERN_POSTER_INVALID:' + kind);
      }
    }
  });

  await expectPass('modern_live_playback_pause_tabs_visibility_and_reduced_motion', async () => {
    const events = new Map(), mediaEvents = [];
    function element(dataset = {}) {
      const ownClasses = new Set();
      return { dataset, events: new Map(), attributes: {}, hidden: false,
        classList: { add: value => ownClasses.add(value), toggle: (value, enabled) => {
          if (enabled) ownClasses.add(value); else ownClasses.delete(value);
        }, contains: value => ownClasses.has(value) },
        addEventListener(name, handler) { this.events.set(name, handler); },
        setAttribute(name, value) { this.attributes[name] = value; }, focus() {},
      };
    }
    const html = await readFile(path.join(source, 'index.html'), 'utf8');
    const deckMarkup = html.slice(html.indexOf('<section class="live-deck"'), html.indexOf('<div class="domain-selector">'));
    const tabs = [...deckMarkup.matchAll(/data-live-tab="([^"]+)"/g)].map(match => element({ liveTab: match[1] }));
    const panelMarkup = [...deckMarkup.matchAll(/<article[^>]*data-live-panel="([^"]+)"[^>]*>[\s\S]*?<\/article>/g)];
    const panels = panelMarkup.map(match => {
      const kind = match[1];
      const node = element({ livePanel: kind });
      node.video = { dataset: { playbackRate: match[0].match(/data-playback-rate="([^"]+)"/)?.[1] },
        currentTime: 0, playing: false, muted: false,
        play() { this.playing = true; return Promise.resolve(); }, pause() { this.playing = false; } };
      node.querySelector = () => node.video;
      return node;
    });
    const control = element({ labelPlay: 'Play', labelPause: 'Pause' });
    const deck = element();
    deck.querySelectorAll = selector => selector === '[data-live-tab]' ? tabs : panels;
    deck.querySelector = selector => {
      if (selector === '[data-motion-toggle]') return control;
      const kind = selector.match(/data-live-panel="([^"]+)"/)?.[1];
      const panel = panels.find(node => node.dataset.livePanel === kind);
      return selector.endsWith(' video') ? panel?.video : panel;
    };
    const preference = { matches: false, addEventListener(name, handler) { mediaEvents.push(handler); } };
    const document = { hidden: false,
      querySelectorAll: selector => selector === '[data-domain]' ? [element()] : [],
      querySelector: selector => selector === '[data-live-deck]' ? deck :
        selector === '.domain-panel' ? { querySelector: () => ({}) } : null,
      addEventListener(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
    };
    let observer;
    class FakeObserver { constructor(callback) { observer = callback; } observe() {} }
    const script = await readFile(path.join(source, 'assets', 'home-v4.js'), 'utf8');
    runInNewContext(script, { document, window: { IntersectionObserver: FakeObserver }, IntersectionObserver: FakeObserver,
      matchMedia: query => query.includes('prefers-reduced-motion') ? preference : { matches: true, addEventListener() {} },
      requestAnimationFrame() { throw new Error('UNEXPECTED_LIVE_CANVAS_LOOP'); }, cancelAnimationFrame() {},
      performance: { now: () => 0 }, devicePixelRatio: 1, addEventListener() {},
      fetch() { throw new Error('LIVE_NETWORK_FORBIDDEN'); },
    });
    const [network, field] = panels.map(panel => panel.video);
    if (!network.playing || field.playing || !field.muted || !network.muted) throw new Error('LIVE_INITIAL_PLAYBACK_INVALID');
    function verifyRates() {
      if (field.playbackRate !== 0.75 || field.defaultPlaybackRate !== 0.75 ||
          network.playbackRate !== 0.85 || network.defaultPlaybackRate !== 0.85) {
        throw new Error('LIVE_SCENE_PLAYBACK_RATE_INVALID');
      }
    }
    verifyRates();
    control.events.get('click')();
    tabs[1].events.get('click')();
    if (field.playing || network.playing || !panels[0].hidden || panels[1].hidden) throw new Error('LIVE_PAUSED_TAB_SWITCH_INVALID');
    control.events.get('click')();
    if (!field.playing || network.playing) throw new Error('LIVE_RESUME_INVALID');
    verifyRates();
    observer([{ isIntersecting: false }]);
    if (field.playing || network.playing) throw new Error('LIVE_OFFSCREEN_PLAYBACK');
    observer([{ isIntersecting: true }]);
    document.hidden = true; events.get('visibilitychange').forEach(handler => handler());
    if (field.playing || network.playing) throw new Error('LIVE_HIDDEN_PLAYBACK');
    document.hidden = false; events.get('visibilitychange').forEach(handler => handler());
    preference.matches = true; mediaEvents.forEach(handler => handler());
    if (field.playing || network.playing || !control.disabled || control.attributes['aria-pressed'] !== 'true') throw new Error('LIVE_REDUCED_MOTION_INVALID');
    preference.matches = false; mediaEvents.forEach(handler => handler());
    if (!field.playing || network.playing || control.disabled) throw new Error('LIVE_PREFERENCE_RESUME_INVALID');
    verifyRates();
  });

  await expectPass('branded_geometry_bilingual', async () => {
    const css = await readFile(path.join(source, 'assets', 'home-v4-finish.css'), 'utf8');
    if (!css.includes('.torsion-visual.is-ready .torsion-visual-fallback') ||
        !css.includes('.brand-motion-toggle[hidden]') || !css.includes('@media (max-width: 560px)')) {
      throw new Error('BRAND_FALLBACK_OR_LAYOUT_MISSING');
    }
    for (const relative of ['index.html', 'en/index.html']) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      for (const kind of ['hero', 'method']) {
        if (!html.includes('data-torsion-visual="' + kind + '"')) throw new Error('BRAND_VISUAL_MISSING');
      }
      if ((html.match(/class="torsion-visual-fallback"/g) ?? []).length !== 2 ||
          (html.match(/class="torsion-water-canvas"/g) ?? []).length !== 2 ||
          !html.includes('data-brand-motion-toggle') || !html.includes('home-v4.js?v=refresh-motion-2') ||
          /class="hero-loop"|class="method-loop"|data-hero-figure|data-hero-tab/.test(html)) {
        throw new Error('BRAND_GEOMETRY_MARKUP_INVALID:' + relative);
      }
    }
  });

  const brandScript = await readFile(path.join(source, 'assets', 'home-v4.js'), 'utf8');
  function brandHarness({ reduced = false, fine = true, methodWidth = 600, methodHeight = 260 } = {}) {
    const frames = new Map(), documentEvents = new Map();
    let frameId = 0, observerCallback;
    function element() {
      const classes = new Set();
      return {
        dataset: {}, events: new Map(), attributes: {}, hidden: false,
        classList: { add: value => classes.add(value), toggle: (value, enabled) => {
          if (enabled) classes.add(value); else classes.delete(value);
        }, contains: value => classes.has(value) },
        addEventListener: function (name, handler) { this.events.set(name, handler); },
        setAttribute: function (name, value) { this.attributes[name] = value; },
      };
    }
    function visual(kind) {
      const node = element(); node.dataset.torsionVisual = kind;
      const positions = [], arcs = [], colors = [];
      const ctx = new Proxy({
        createLinearGradient: () => ({ addColorStop: () => {} }),
        moveTo: (x, y) => positions.push([x, y]),
        lineTo: (x, y) => positions.push([x, y]),
        arc: (x, y, radius) => arcs.push([x, y, radius]),
        clearRect: () => { positions.length = 0; arcs.length = 0; colors.length = 0; },
      }, {
        get: (target, key) => key in target ? target[key] : () => {},
        set: (target, key, value) => {
          target[key] = value;
          if (key === 'strokeStyle' || key === 'fillStyle') colors.push(value);
          return true;
        },
      });
      node.canvas = { width: 0, height: 0, getContext: () => ctx,
        getBoundingClientRect: () => ({ width: kind === 'method' ? methodWidth : 600,
          height: kind === 'method' ? methodHeight : 600, left: 0, top: 0 }) };
      node.querySelector = () => node.canvas;
      node.stages = kind === 'method' ? Array.from({ length: 4 }, () => element()) : [];
      node.querySelectorAll = () => node.stages;
      node.positions = positions; node.arcs = arcs; node.colors = colors;
      return node;
    }
    const hero = visual('hero'), method = visual('method'), control = element();
    control.dataset = { labelPause: 'Pause', labelPlay: 'Resume', labelStatic: 'Reduced' };
    const reduceMedia = { matches: reduced, addEventListener: function (name, handler) { this.change = handler; } };
    const fineMedia = { matches: fine, addEventListener: function (name, handler) { this.change = handler; } };
    const button = element();
    const document = {
      hidden: false,
      querySelectorAll: selector => selector === '[data-torsion-visual]' ? [hero, method] : selector === '[data-domain]' ? [button] : [],
      querySelector: selector => selector === '[data-brand-motion-toggle]' ? control :
        selector === '.domain-panel' ? { querySelector: () => ({}) } : null,
      addEventListener: (name, handler) => documentEvents.set(name, handler),
    };
    class FakeObserver {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    }
    runInNewContext(brandScript, {
      document, window: { IntersectionObserver: FakeObserver }, IntersectionObserver: FakeObserver,
      matchMedia: query => query.includes('prefers-reduced-motion') ? reduceMedia : fineMedia,
      requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame: id => frames.delete(id), performance: { now: () => 0 },
      devicePixelRatio: 1, addEventListener: () => {},
      fetch: () => { throw new Error('BRAND_TEST_NETWORK_FORBIDDEN'); },
      Image: function () { throw new Error('BRAND_TEST_LEGACY_IMAGE_FORBIDDEN'); },
    });
    return {
      hero, method, control, frames, document, reduceMedia, fineMedia,
      advance(time) {
        const pending = [...frames.values()]; frames.clear();
        for (const callback of pending) callback(time);
        if (frames.size > 1) throw new Error('DUPLICATE_BRAND_ANIMATION_LOOP');
      },
      visible(value) { observerCallback([hero, method].map(target => ({ target, isIntersecting: value }))); },
      visibleStates(heroVisible, methodVisible) {
        observerCallback([{ target: hero, isIntersecting: heroVisible },
          { target: method, isIntersecting: methodVisible }]);
      },
      hide(value) { document.hidden = value; documentEvents.get('visibilitychange')(); },
    };
  }

  await expectPass('brand_motion_rotates_and_ripples', async () => {
    const resting = brandHarness(), hovering = brandHarness();
    const initial = JSON.stringify(resting.hero.positions);
    resting.advance(16); hovering.advance(16);
    hovering.hero.events.get('pointermove')({ clientX: 405, clientY: 300 });
    resting.advance(32); hovering.advance(32);
    if (initial === JSON.stringify(resting.hero.positions) ||
        JSON.stringify(resting.hero.positions) === JSON.stringify(hovering.hero.positions) ||
        !hovering.hero.positions.every(point => point.every(Number.isFinite))) {
      throw new Error('BRAND_ROTATION_OR_WATER_RESPONSE_MISSING');
    }
    hovering.hero.events.get('pointerleave')();
    hovering.advance(48);
  });

  await expectPass('brand_motion_pause_resume_visibility', async () => {
    const harness = brandHarness();
    harness.advance(16);
    harness.control.events.get('click')();
    const paused = JSON.stringify(harness.hero.positions);
    harness.advance(32);
    if (harness.frames.size !== 0 || harness.control.attributes['aria-pressed'] !== 'true' ||
        paused !== JSON.stringify(harness.hero.positions)) throw new Error('BRAND_PAUSE_FAILED');
    harness.control.events.get('click')();
    if (harness.frames.size !== 1) throw new Error('BRAND_RESUME_FAILED');
    harness.hide(true);
    if (harness.frames.size !== 0) throw new Error('BRAND_HIDDEN_TAB_ANIMATING');
    harness.hide(false);
    if (harness.frames.size !== 1) throw new Error('BRAND_VISIBLE_TAB_NOT_RESUMED');
  });

  await expectPass('brand_motion_reduced_and_coarse_preferences', async () => {
    const reduced = brandHarness({ reduced: true });
    if (reduced.frames.size !== 0 || !reduced.control.disabled ||
        !reduced.hero.classList.contains('is-ready')) throw new Error('BRAND_REDUCED_MOTION_FAILED');
    const live = brandHarness();
    live.reduceMedia.matches = true; live.reduceMedia.change();
    if (live.frames.size !== 0 || !live.control.disabled) throw new Error('BRAND_PREFERENCE_CHANGE_FAILED');
    const coarse = brandHarness({ fine: false }), neutral = brandHarness({ fine: false });
    coarse.hero.events.get('pointermove')({ clientX: 405, clientY: 300 });
    coarse.advance(16); neutral.advance(16);
    if (JSON.stringify(coarse.hero.positions) !== JSON.stringify(neutral.hero.positions)) {
      throw new Error('BRAND_COARSE_POINTER_WATER_RESPONSE');
    }
  });

  await expectPass('brand_motion_offscreen_suspension', async () => {
    const harness = brandHarness();
    harness.visible(false);
    if (harness.frames.size !== 0) throw new Error('BRAND_OFFSCREEN_ANIMATING');
    harness.visible(true);
    if (harness.frames.size !== 1) throw new Error('BRAND_VIEWPORT_RESUME_FAILED');
  });

  await expectPass('method_flow_bilingual_jade_and_fallback', async () => {
    const css = await readFile(path.join(source, 'assets', 'home-v4-finish.css'), 'utf8');
    if (!css.includes('--method-jade: #247b63') || !css.includes('aspect-ratio: 1.6') ||
        !css.includes('.method-flow-stages .is-active')) throw new Error('METHOD_FLOW_JADE_OR_RESPONSIVE_MISSING');
    for (const [relative, labels, heading] of [
      ['index.html', ['Pregunta', 'Contraste', 'Corrección', 'Evidencia'], 'De la pregunta<br>a la evidencia.'],
      ['en/index.html', ['Question', 'Contrast', 'Correction', 'Evidence'], 'From question<br>to evidence.'],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const start = html.indexOf('<figure class="torsion-visual torsion-visual--method method-flow"');
      const method = html.slice(start, html.indexOf('</figure>', start));
      if (start < 0 || !html.includes(heading) || !method.includes('<ol class="method-flow-stages">') ||
          (method.match(/data-flow-stage=/g) ?? []).length !== 4 ||
          /torsion-fallback-arms|rotate\(|r="52"/.test(method) ||
          !method.includes('method-flow-fallback-active') || !labels.every(label => method.includes(label))) {
        throw new Error('METHOD_FLOW_STRUCTURE_INVALID:' + relative);
      }
    }
  });

  await expectPass('method_flow_idle_is_static_without_helix', async () => {
    const harness = brandHarness(); harness.visibleStates(false, true);
    const initial = JSON.stringify(harness.method.positions);
    harness.advance(1600);
    if (harness.frames.size !== 0 || initial !== JSON.stringify(harness.method.positions) ||
        !harness.method.arcs.every(([, , radius]) => radius <= 7) ||
        !harness.method.stages[1].classList.contains('is-active')) {
      throw new Error('METHOD_FLOW_IDLE_NOT_STATIC_OR_LARGE_ORBIT');
    }
  });

  await expectPass('method_flow_hover_ripple_jade_and_settle', async () => {
    const harness = brandHarness(); harness.visibleStates(false, true);
    const baselinePositions = JSON.stringify(harness.method.positions);
    harness.method.events.get('pointermove')({ clientX: 380, clientY: 107 });
    harness.advance(16); harness.advance(32);
    if (harness.frames.size !== 1 || baselinePositions === JSON.stringify(harness.method.positions) ||
        !harness.method.stages[2].classList.contains('is-active') || !harness.method.colors.includes('#247b63') ||
        !harness.method.positions.every(point => point.every(Number.isFinite))) {
      throw new Error('METHOD_FLOW_HOVER_OR_JADE_FAILED');
    }
    harness.method.events.get('pointerleave')();
    for (let frame = 3; frame <= 90; frame += 1) harness.advance(frame * 16);
    const settled = JSON.stringify(harness.method.positions);
    harness.advance(3200);
    if (harness.frames.size !== 0 || !harness.method.stages[1].classList.contains('is-active') ||
        settled !== JSON.stringify(harness.method.positions)) throw new Error('METHOD_FLOW_NOT_SETTLED');
  });

  await expectPass('method_flow_reduced_motion_and_compact_bounds', async () => {
    const reduced = brandHarness({ reduced: true }); reduced.visibleStates(false, true);
    const staticPoints = JSON.stringify(reduced.method.positions);
    reduced.method.events.get('pointermove')({ clientX: 380, clientY: 107 }); reduced.advance(32);
    if (reduced.frames.size !== 0 || staticPoints !== JSON.stringify(reduced.method.positions)) {
      throw new Error('METHOD_FLOW_REDUCED_MOTION_FAILED');
    }
    const compact = brandHarness({ methodWidth: 320, methodHeight: 200 }); compact.visibleStates(false, true);
    compact.method.events.get('pointermove')({ clientX: 203, clientY: 82 }); compact.advance(16);
    if (!compact.method.positions.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) &&
        x >= 0 && x <= 320 && y >= 0 && y <= 200)) throw new Error('METHOD_FLOW_COMPACT_CLIPPED');
  });

  await expectPass('contact_email_and_privacy_scope_bilingual', async () => {
    for (const [relative, noticeLink, rightsLink] of [
      ['contacto/index.html', '/privacidad/#consultas-colaboracion', '/privacidad/#aviso-integral'],
      ['en/contact/index.html', '/en/privacy/#collaboration-inquiries', '/en/privacy/#full-notice'],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      const mailLinks = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((match) => match[1]);
      if (mailLinks.length !== 1 || mailLinks[0] !== 'mailto:operacion@torsion-labs.com' ||
          !html.includes(`href="${noticeLink}"`) || !html.includes(`href="${rightsLink}"`) ||
          /<form\b|pendiente de apertura|channel not yet open|channel in preparation|canal institucional en preparación/i.test(html)) {
        throw new Error(`CONTACT_SCOPE_INVALID:${relative}`);
      }
    }
  });
  await expectPass('inbound_notice_keeps_draft_controls_and_separate_purposes', async () => {
    for (const [relative, fragment, countLabel, exclusion] of [
      ['privacidad/index.html', 'consultas-colaboracion', 'Tres tratamientos delimitados.', 'no quedan habilitadas por este aviso'],
      ['en/privacy/index.html', 'collaboration-inquiries', 'Three defined activities.', 'are not enabled by this notice'],
    ]) {
      const html = await readFile(path.join(source, ...relative.split('/')), 'utf8');
      if (!html.includes('content="noindex,nofollow"') ||
          !html.includes('LOCAL_DRAFT_PUBLICATION_NO_GO') || !html.includes(`id="${fragment}"`) ||
          !html.includes(countLabel) || !html.includes(exclusion) || !html.includes('operacion@torsion-labs.com') ||
          html.split('{{CONTROLLER_NAME}}').length !== 2 || html.split('{{CONTROLLER_ADDRESS}}').length !== 2 ||
          html.split('{{PRIVACY_EMAIL}}').length !== 3 ||
          /\b(?:90|180|365|30|10)\s*(?:d[ií]as|days)\b|<form\b/i.test(html)) {
        throw new Error(`INBOUND_NOTICE_SCOPE_INVALID:${relative}`);
      }
    }
  });
  await expectPass('inbound_notice_survives_fake_identity_release_without_widening_scope', async () => {
    for (const [relative, fragment, scope] of [
      ['privacidad/index.html', 'consultas-colaboracion', 'CUR-04, sólo recepción'],
      ['en/privacy/index.html', 'collaboration-inquiries', 'CUR-04, inbound only'],
    ]) {
      const html = await readFile(path.join(releaseOutput, ...relative.split('/')), 'utf8');
      if (!html.includes(`id="${fragment}"`) || !html.includes(scope) ||
          !html.includes('operacion@torsion-labs.com') || !html.includes('privacidad@torsion-labs.com') ||
          !html.includes('content="index,follow"') || !html.includes('SYNTHETIC ADDRESS &lt;TEST&gt; 123')) {
        throw new Error(`INBOUND_RELEASE_INVALID:${relative}`);
      }
    }
  });
  await expectPass('manual_milestone_editorial_status_bilingual', async () => {
    for (const relative of ['portafolio/index.html', 'en/portfolio/index.html', 'evidencia/index.html',
      'en/evidence/index.html', 'proyectos/biomedicina/index.html', 'en/proyectos/biomedicina/index.html']) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (/semanal|weekly/i.test(html)) throw new Error(`FIXED_CADENCE_CLAIM:${relative}`);
    }
    for (const [relative, label] of [['portafolio/index.html', 'revisión editorial manual'],
      ['en/portfolio/index.html', 'manual editorial review']]) {
      if (!(await readFile(path.join(baseline, ...relative.split('/')), 'utf8')).includes(label)) {
        throw new Error(`MANUAL_EDITORIAL_LABEL_MISSING:${relative}`);
      }
    }
  });
  await expectPass('inquiry_sent_is_not_delivery_reply_or_affiliation_bilingual', async () => {
    for (const [relative, markers] of [
      ['evidencia/index.html', ['Al corte de agosto de 2026', '5 octubre 2026', 'UAQ', 'confirmado por D9', 'no acredita entrega, lectura, respuesta', 'colaboración institucional ni aval']],
      ['en/evidence/index.html', ['As of the August 2026 snapshot', 'October 5, 2026', 'UAQ', 'D9 confirmed', 'does not establish delivery, reading, a reply', 'institutional collaboration or endorsement']],
      ['ciencia/index.html', ['Al corte del 12 de agosto de 2026', '5 de octubre', 'no cambia el estado de esta revisión']],
      ['en/science/index.html', ['As of August 12, 2026', 'October 5', "does not change this review's status"]],
    ]) {
      const html = await readFile(path.join(baseline, ...relative.split('/')), 'utf8');
      if (!markers.every((marker) => html.includes(marker))) throw new Error(`DATED_INQUIRY_LIMIT_MISSING:${relative}`);
    }
  });
  await expectPass('all_local_html_fragment_links_have_targets', async () => {
    const contract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
    const pages = contract.runtime_allowlist.filter((relative) => relative.endsWith('.html'));
    const texts = new Map(await Promise.all(pages.map(async (relative) =>
      [relative, await readFile(path.join(baseline, ...relative.split('/')), 'utf8')])));
    for (const [relative, html] of texts) {
      for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*#[^"]+)"/g)) {
        const raw = match[1];
        if (/^(?:https?:|mailto:|tel:)/i.test(raw)) continue;
        const url = new URL(raw, `https://local.invalid/${relative}`);
        const pathname = decodeURIComponent(url.pathname).slice(1);
        const target = pathname.endsWith('/') || !pathname ? `${pathname}index.html` : pathname;
        const targetHtml = texts.get(target);
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (!targetHtml || ![...targetHtml.matchAll(/\b(?:id|name)="([^"]+)"/g)].some((item) => item[1] === fragment)) {
          throw new Error(`LOCAL_FRAGMENT_TARGET_MISSING:${relative}:${raw}`);
        }
      }
    }
  });

  const seoHomes = [
    ['index.html', 'Torsión Labs · Investigación computacional y tecnología',
      'Investigación computacional y desarrollo tecnológico en seis áreas. Proyectos, software y evidencia con alcance y límites explícitos.',
      'Conectar lo que parece separado.'],
    ['en/index.html', 'Torsion Labs · Computational research and technology',
      'Computational research and technology development across six areas. Explore projects, software and evidence with explicit scope and limitations.',
      'Connecting what appears separate.'],
  ];
  const seoContract = JSON.parse(await readFile(path.join(source, 'config', 'public-artifact-contract.json'), 'utf8'));
  const seoProfiles = seoContract.external_navigation_allowlist;
  await expectPass('seo_home_metadata_bilingual_and_visible_heading_preserved', async () => {
    for (const [relative, title, description, heading] of seoHomes) {
      for (const root of [source, baseline, releaseOutput]) {
        const html = await readFile(path.join(root, ...relative.split('/')), 'utf8');
        if (!html.includes(`<title>${title}</title>`) || !html.includes(`<h1>${heading}</h1>`) ||
            !html.includes(`<meta name="description" content="${description}">`) ||
            !html.includes(`<meta property="og:title" content="${title}">`) ||
            !html.includes(`<meta property="og:description" content="${description}">`) ||
            !html.includes(`<meta name="twitter:title" content="${title}">`) ||
            !html.includes(`<meta name="twitter:description" content="${description}">`) ||
            !html.includes('content="https://torsion-labs.com/assets/og-image.png"')) {
          throw new Error(`SEO_HOME_METADATA_INVALID:${relative}`);
        }
      }
    }
  });
  await expectPass('seo_identity_is_inert_public_only_and_matches_approved_profiles', async () => {
    for (const [relative, , description] of seoHomes) {
      for (const root of [source, baseline, releaseOutput]) {
        const html = await readFile(path.join(root, ...relative.split('/')), 'utf8');
        validateSeoIdentity(readSeoIdentity(html), description, seoProfiles);
      }
    }
    const logo = await readFile(path.join(baseline, 'assets', 'logo-torsion.svg'), 'utf8');
    if (!/<svg\b/.test(logo) || !logo.includes('viewBox="0 0 120 120"')) {
      throw new Error('SEO_LOGO_IMAGE_INVALID');
    }
  });
  await expectPass('seo_notice_canonical_hreflang_survives_both_privacy_modes', async () => {
    for (const [relative, canonical] of [
      ['privacidad/index.html', 'https://torsion-labs.com/privacidad/'],
      ['en/privacy/index.html', 'https://torsion-labs.com/en/privacy/'],
    ]) {
      for (const root of [source, baseline, releaseOutput]) {
        const html = await readFile(path.join(root, ...relative.split('/')), 'utf8');
        if (!html.includes(`<link rel="canonical" href="${canonical}">`) ||
            (html.match(/rel="canonical"/g) ?? []).length !== 1 ||
            !html.includes('<link rel="alternate" hreflang="es" href="https://torsion-labs.com/privacidad/">') ||
            !html.includes('<link rel="alternate" hreflang="en" href="https://torsion-labs.com/en/privacy/">') ||
            (html.match(/hreflang=/g) ?? []).length !== 2 || /<script\b/i.test(html)) {
          throw new Error(`SEO_NOTICE_ALTERNATES_INVALID:${relative}`);
        }
        if (root !== releaseOutput && (!html.includes('content="noindex,nofollow"') ||
            !html.includes('LOCAL_DRAFT_PUBLICATION_NO_GO'))) throw new Error('SEO_DRAFT_GATE_CHANGED');
        if (root === releaseOutput && !html.includes('content="index,follow"')) {
          throw new Error('SEO_RELEASE_INDEXING_CHANGED');
        }
      }
    }
  });
  await expectPass('seo_sitemap_covers_26_public_routes_and_excludes_404', async () => {
    const expected = seoContract.runtime_allowlist.filter(relative => relative.endsWith('index.html'))
      .map(relative => 'https://torsion-labs.com/' + relative.replace(/index\.html$/, ''));
    for (const root of [source, baseline, releaseOutput]) {
      const xml = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
      const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
      const actual = blocks.map(block => block[1].match(/<loc>([^<]+)<\/loc>/)?.[1]);
      if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') ||
          !xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"') ||
          expected.length !== 26 || actual.length !== 26 || new Set(actual).size !== 26 ||
          !expected.every(url => actual.includes(url)) || actual.some(url => /404|\.pages\.dev|127\.0\.0\.1/.test(url))) {
        throw new Error('SEO_SITEMAP_ROUTES_INVALID');
      }
      for (const notice of ['https://torsion-labs.com/privacidad/', 'https://torsion-labs.com/en/privacy/']) {
        const block = blocks.find(candidate => candidate[1].includes(`<loc>${notice}</loc>`))?.[1] ?? '';
        if (!block.includes('hreflang="es" href="https://torsion-labs.com/privacidad/"') ||
            !block.includes('hreflang="en" href="https://torsion-labs.com/en/privacy/"')) {
          throw new Error('SEO_SITEMAP_NOTICE_ALTERNATES_INVALID');
        }
      }
    }
  });
  await expectPass('seo_preserves_security_headers_and_nonindexable_404', async () => {
    const headers = await readFile(path.join(baseline, '_headers'), 'utf8');
    if (!seoContract.required_security_headers.every(header => headers.includes(header)) ||
        !headers.includes("script-src 'self'") || /unsafe-inline|unsafe-eval/i.test(headers)) {
      throw new Error('SEO_SECURITY_POLICY_WEAKENED');
    }
    const notFound = await readFile(path.join(baseline, '404.html'), 'utf8');
    if (!notFound.includes('content="noindex,nofollow"') || /application\/ld\+json/i.test(notFound)) {
      throw new Error('SEO_404_CONTROLS_CHANGED');
    }
  });
  const seoIdentityFixture = readSeoIdentity(await readFile(path.join(source, 'index.html'), 'utf8'));
  await expectFail('reject_unapproved_structured_profile', 'SEO_IDENTITY_INVALID', async () =>
    validateSeoIdentity({ ...seoIdentityFixture, sameAs: [...seoProfiles.slice(0, 2), 'https://example.invalid/not-approved'] },
      seoHomes[0][2], seoProfiles));
  await expectFail('reject_structured_private_fields', 'SEO_IDENTITY_INVALID', async () =>
    validateSeoIdentity({ ...seoIdentityFixture, address: 'SYNTHETIC PRIVATE FIELD' }, seoHomes[0][2], seoProfiles));
  await expectFail('reject_active_structured_script_attributes', 'SEO_IDENTITY_ACTIVE_ATTRIBUTES', async () =>
    readSeoIdentity((await readFile(path.join(source, 'index.html'), 'utf8'))
      .replace('<script type="application/ld+json">', '<script type="application/ld+json" src="/assets/home-v4.js">')));

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
    .replace('href="https://github.com/torsion-labs"', 'href="https://github.com/not-torsion"'));
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
    .replace('href="/assets/home-v4.css?v=refresh-theme-1"', 'href="https://github.com/torsion-labs"'));
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
