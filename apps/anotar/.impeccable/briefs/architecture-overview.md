# Architecture overview

- Surface: `docs/architecture-overview.html`; mode: Read.
- Request: 기술 스택과 전반적인 아키텍처를 HTML로 보여주기.
- Scope: standalone explanation of current code, Oracle deployment proposal including independent static HTML sites, and offline synchronization.
- Preserve incumbent warm paper/forest light theme and charcoal dark theme. This document adds no product-wide design rules.
- Interaction: three accessible tabs; component selection exposes source-grounded role, technology, related code, and additional edges. Long arrows travel through gutters outside nodes.
- Small screens: concise flow summary, deliberate horizontal diagram/table panning, no document overflow.
- Portability: inline CSS/JS, no external runtime/assets, local file opening; print all three panels with light colors.
- Truth: actual implementation and external integrations are separated from undeployed proposals. Example domains are illustrative. No performance measurements or deployment completion claimed.
- Evidence: `.omo/evidence/architecture-20261004/verification.json` and viewport screenshots.
- Documentation check: incumbent PRODUCT.md, DESIGN.md and design.json remain unchanged; artifact-only values are not promoted into the product design system.

- 2026-10-05 extension: Settings → 서비스 정보 opens the canonical HTML in a new tab; same source is emitted for the build and included in the offline shell. Current auth and Oracle VM preparation are explained separately from undeployed app/TLS proposals. Detailed entry flows, file search, data contracts, API and debugging maps supplement the original diagrams.
- New evidence destination: `.omo/evidence/architecture-callout/`.
