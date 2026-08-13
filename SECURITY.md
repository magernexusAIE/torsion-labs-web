# Security Policy

## Reporting a vulnerability

The static website is published at **https://torsion-labs.com** from the public repository
`magernexusAIE/torsion-labs-web` through Cloudflare Pages.

The corporate mailbox and private security-reporting channel are not active yet. Do not send
sensitive vulnerability details to an address that is not explicitly identified here as verified,
and do not open a public issue containing exploit details or confidential information.

The verified reporting address, acknowledgement target, account-recovery controls, and
incident-response owner will be published here after they have been activated and tested. Until
then, retain sensitive report details for the verified channel and do not transmit them through
public issues, forms, social networks, or unverified addresses.

## Scope

This repository contains a static website only. It holds no user data, no backend and no
credentials. The intended security scope includes the public site's headers, content-security
policy, static assets, routing, and public CI pipeline without exposing internal systems.

Images, fonts, posters, and video loops are self-hosted. The multimedia module does not request
remote streams, analytics, maps, telemetry, accounts, or third-party players.
