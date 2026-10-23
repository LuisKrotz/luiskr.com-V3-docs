# luiskr.com V3 — experiments/docs

The in-app documentation portal — `<view-docs>` — the browsable documentation
surface reachable at `/docs`. This is where the whole repository documents itself:
curated markdown, generated JSDoc API pages, source files (comment-carrying),
coverage reports, and the deploy-info bundle — all navigable through one lazy
portal.

## How it works

The portal is a two-sided pipeline:

**Build side** (`shared/build/docs/`) — at build time, `scan.mjs` walks the
publishable roots into a manifest (`docs`, `reports`, `src`, `core`, `website`,
`cms`, `earth`, `docs-exp`, `local-modules`, coverage dirs). `render.mjs` renders
each file to HTML (markdown via marked, source syntax-highlighted, coverage
sandboxed). `redact.mjs` scrubs secrets. `encode.mjs` compacts the manifest —
one `strings` table per distinct name/rel-path plus per-node tuples, so
`docs-portal.mjs` emits `virtual:docs-manifest` ~8× smaller than the scanned
tree — and every file as a lazy `docs-content/<root>/<path>.json`
payload — in dev, the identical payloads come from Vite middleware.

**Browser side** (this module) — `<view-docs>` renders the manifest as a
recursive treeview + folder grid + editable breadcrumbs. Selecting a file fetches
its `docs-content/*.json` lazily — the viewer never ships the whole corpus.

## Source map

| File              | What it does                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Docs.tsx`        | `<view-docs>` — the portal route: treeview, breadcrumbs, folder grid, file viewer, plus the WebGL backdrop and 3D architecture scene.                                 |
| `manifest.ts`     | `virtual:docs-manifest` access + path resolution — the tree of publishable roots with ids that double as fetch paths.                                                 |
| `render.tsx`      | JSX template — header, GL strip, treeview, breadcrumbs, folder grid, viewer, legal footer.                                                                            |
| `arch-scene.ts`   | Interactive three.js visualization of the manifest — directories as a 3D radial tree: nodes on depth rings, parent→child edges, click-to-pick navigates the portal.   |
| `folder-svg.tsx`  | Deterministic animated folder glyphs — each card's SVG is generated _from its name_ (hash → thread count, phase, curvature), so no two folders look alike.            |
| `gl-strip.ts`     | WebGL thread-field backdrop — slow-drifting iso-lines of a layered sine field, tuned faint to read as texture behind navigation chrome.                               |
| `mermaid.ts`      | Mermaid diagram rendering — ` ```mermaid ` fences lazily import mermaid, skinned with live theme tokens (follows light/dark).                                         |
| `coverage-nav.ts` | Istanbul coverage-report interactivity — coverage HTML ships external scripts the sanitizer strips, so this re-implements block-navigation, sorting, and file search. |
| `copy-guard.ts`   | Copy-protection for the source viewer — intercepts copy/cut/contextmenu/selectstart/dragstart/beforeprint and rewrites clipboard payloads to the repo URL.            |
| `telemetry.ts`    | Copy-attempt telemetry — guarded interactions post a record to RTDB `docs-stats/copy-attempts` via REST (no SDK chunk).                                               |
| `loader.ts`       | Boot-loader lifecycle — the overlay stays until manifest resolved + scene mounted + in-flight payload settled.                                                        |
| `index.ts`        | Barrel — the `<view-docs>` element plus the manifest contract.                                                                                                        |
| `dev.ts`          | Standalone dev entry — mounts `<view-docs>` directly; the module vite config wires the docs-portal plugin so `virtual:docs-manifest` resolves identically.            |
| `vite.config.js`  | Library build — emits `experiments/docs/dist/docs.js`; `virtual:docs-manifest` and mermaid/marked stay external.                                                      |

## What shows under docs

| Portal root                 | Maps to                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `docs:`                     | `shared/docs/` — curated guides, architecture, generated API pages |
| `reports:`                  | `experiments/docs/reports/` — scan/verify output                   |
| `src:`                      | `shared/src/` — the app shell                                      |
| `shared:`                   | `shared/` — scripts, build, tooling (`docs/` + `local-modules/`    |
|                             | skipped — they publish under their own roots)                      |
| `core:`, `website:`, `cms:` | those modules' source trees (comments included)                    |
| `earth:`, `docs-exp:`       | the earth-playground and docs modules                              |
| `starfield:`                | `experiments/star-field/` — source + README (`public/` skipped)    |
| `desktop:`                  | `desktop/` — the Electron shell                                    |
| `local-modules:`            | the vendored security replacements                                 |
| `coverage-*:`               | per-module Istanbul coverage reports                               |

Every module's `README.md` is itself a portal page — `/docs/<root>/README.md`.

## Commands

```bash
yarn dev      # mounts <view-docs> directly
yarn test     # jest suite for docs
yarn build    # emits experiments/docs/dist/docs.js
```

---

Submodule of [luiskr.com-V3](https://github.com/LuisKrotz/luiskr.com-V3). Install
deps from the superproject (`yarn install` at the root), then run `yarn dev` /
`yarn test` / `yarn build` in this folder — see `package.json` scripts.

License: [MPL-2.0](https://github.com/LuisKrotz/luiskr.com-V3/blob/development/LICENSE)
