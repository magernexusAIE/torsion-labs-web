# torsion-labs.com

Public website of **Torsión · Genesis Lab** — an independent research laboratory in Querétaro,
Mexico. Six research lines are connected through provenance contracts, cross-review, reproducible
software tests, documentary checks, and human adjudication: energy, security & economics,
biomedical prediction, perception, education, and physical modeling.

This repository contains the static bilingual site. The cinematic Home opens the public vision;
Science explains the research program; Portfolio presents six active domains and their deep
profiles; Evidence records results and limits; Contact defines institutional routes. It is built
with plain HTML/CSS/JS — no framework, no build step, and no remotely loaded runtime assets.

The Home includes two original, self-hosted eight-second visual loops: **Torsional field** and
**Federated network**. They are conceptual visualizations, not physical measurements or live
telemetry. Accessible tabs, an explicit pause control, and reduced-motion handling govern playback.

## Structure

```
index.html · en/      cinematic Home ES/EN
ciencia/ · en/science/       research program
portafolio/ · en/portfolio/  six domains and deep profiles
evidencia/ · en/evidence/    public evidence record
contacto/ · en/contact/      institutional routes
proyectos/ · en/proyectos/   six reconciled deep profiles
assets/               local motion, logo, imagery, video loops, self-hosted fonts
_headers              security headers (CSP, HSTS, X-Frame-Options)
robots.txt            SEO
sitemap.xml           bilingual sitemap (hreflang)
.github/workflows/    CI guard (blocks secrets/keys before deploy)
config/               sealed runtime contract and SHA-256 manifest (repository only)
scripts/              deterministic dist builder and fail-closed tests (repository only)
```

## Publication status

The site is publicly available at **https://torsion-labs.com** and is deployed as a static site on
Cloudflare Pages from the public repository `magernexusAIE/torsion-labs-web`, branch `main`. The
canonical public host is `torsion-labs.com`; `www.torsion-labs.com` redirects permanently to it.
The currently published revision uses plain static files from the repository root and has no build
command. That remains the observed production state until the separately governed Pages cutover
activates the deterministic `dist` build described below. The site requires no application backend.

The corporate mailbox and private security-reporting channel are separate pending capabilities.
No email address is presented as active until that mailbox and its recovery controls have been
created and verified.

The repository defines a governed Pages build into a fresh `dist` directory. The deterministic
builder admits exactly 61 runtime files, including a custom `404.html`, and excludes README,
SECURITY, `.github`, `config`, and `scripts` from the served site. A source change alone does not
activate that output contract: the Pages cutover and its production verification remain separately
governed operations.

## Security

The public security-reporting channel is pending activation and verification. Do not send sensitive
reports to an address that is not explicitly published as verified in `SECURITY.md`.

## About

We publish the architecture and the evidence, not the core. Every claim on the site is labeled by
evidence class: tested software, computational model, documentary check, active research, or
projection. Local tests are not presented as physical, clinical, or production validation.

© 2026 Torsión · Genesis Lab
