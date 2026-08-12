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
```

## Planned deployment

The deployment provider, public repository, branch policy, previews, and production cutover remain
under governance review. This local candidate has no active domain, mailbox, public repository, or
deployment. It uses plain static files and requires no build step.

## Security

The public security-reporting channel is pending activation and verification. See `SECURITY.md`.

## About

We publish the architecture and the evidence, not the core. Every claim on the site is labeled by
evidence class: tested software, computational model, documentary check, active research, or
projection. Local tests are not presented as physical, clinical, or production validation.

© 2026 Torsión · Genesis Lab
