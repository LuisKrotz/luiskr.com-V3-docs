/**
 * @file docs/manifest.ts
 * @description Build-time docs manifest access + path resolution.
 *
 * `virtual:docs-manifest` arrives as compact interned tuples (emitted by
 * shared/build/docs/encode.mjs): every distinct name/label/kind/rel-path
 * lives once in `strings`, and each node tuple carries only a name index
 * plus an mtime (files) or child tuples (dirs). `path`/`id` are never
 * serialized — hydrateManifest() derives them positionally, with an
 * optional trailing rel index covering case-merged subtrees whose real
 * rel path cannot be derived. File payloads are NOT in the manifest;
 * they're fetched on open so the route chunk stays small against ~3.5k
 * documents.
 */

import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import manifest, { type DocsWireManifest, type DocsWireNode } from 'virtual:docs-manifest'

/** One manifest node — dir carries children, file carries id + mtime. */
export interface DocsNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: DocsNode[]
  id?: string
  mtime?: string
  /** Scene-only flag — `+N` aggregate leaves the leaf cap synthesizes
   *  for surplus file children; the map colors them with the dir ink. */
  aggregate?: boolean
  /** View-synthesized section node — a disclosure wrapper the portal
   *  tree/grid renders above the real roots (Source Code, Documentation,
   *  Architecture Docs, Reports). Toggles only: no manifest path or
   *  route exists for a section, so group rows never navigate. */
  group?: boolean
}

/** A publishable root bucket (docs / reports / coverage-* / source modules). */
export interface DocsRoot {
  root: string
  label: string
  /**
   * Behavior class emitted by shared/build/docs/scan.mjs: 'source' roots
   * are protected (copy-guard, no index auto-open); 'coverage' roots are
   * per-module test reports; 'docs'/'reports' are browsable content.
   */
  kind?: 'source' | 'coverage' | 'docs' | 'reports'
  children: DocsNode[]
}

/** Manifest object emitted by the vite plugin. */
export interface DocsManifest {
  generated: string
  roots: DocsRoot[]
}

/** Rendered payload returned by /docs-content/<id>.json. */
export interface DocsFilePayload {
  name: string
  path: string
  format: string
  html: string | null
  media: string | null
  mtime: string
}

/**
 * Expands one wire children list into manifest nodes. Names and rel-path
 * overrides resolve through the strings table; `path` is the root name
 * plus the ancestor rel chain, `id` the same rel under the ':'
 * namespace, and file `mtime` the epoch-ms value restored to ISO — the
 * same fields the scan emitted without any of them crossing the wire.
 * @param tuples    Wire children tuples of one parent.
 * @param wire      Full wire manifest (strings table).
 * @param root      Root namespace ('docs' → path/id prefix).
 * @param parentRel Parent's real rel path ('' at a root's top level).
 * @returns Hydrated nodes in wire order.
 */
const hydrateChildren = (
  tuples: DocsWireNode[],
  wire: DocsWireManifest,
  root: string,
  parentRel: string
): DocsNode[] =>
  tuples.map((t): DocsNode => {
    const name = wire.strings[t[0]]

    const rel =
      typeof t[2] === 'number'
        ? wire.strings[t[2]]
        : parentRel
          ? `${parentRel}${CHAR_STRINGS.SLASH}${name}`
          : name

    const path = `${root}${CHAR_STRINGS.SLASH}${rel}`

    return Array.isArray(t[1])
      ? { type: 'dir', name, path, children: hydrateChildren(t[1], wire, root, rel) }
      : {
          type: 'file',
          name,
          path,
          id: `${root}${CHAR_STRINGS.COLON}${rel}`,
          mtime: new Date(t[1]).toISOString(),
        }
  })

/**
 * Expands the wire manifest into the runtime tree — roots decode their
 * name/label/kind through the strings table, children hydrate
 * recursively. Runs once at module init so getDocsManifest() stays a
 * cheap accessor.
 * @param wire Compact manifest from virtual:docs-manifest.
 * @returns The full DocsManifest the portal consumes.
 */
const hydrateManifest = (wire: DocsWireManifest): DocsManifest => ({
  generated: wire.generated,
  roots: wire.roots.map(([rootIdx, labelIdx, kindIdx, children]) => {
    const root = wire.strings[rootIdx]

    return {
      root,
      label: wire.strings[labelIdx],
      kind: wire.strings[kindIdx] as DocsRoot['kind'],
      children: hydrateChildren(children, wire, root, CHAR_STRINGS.EMPTY),
    }
  }),
})

const _manifest = hydrateManifest(manifest)

/** The scanned manifest — the vite plugin + jest stub always emit one. */
export const getDocsManifest = (): DocsManifest => _manifest

/** Direct-member path → its section's path (e.g. 'src' → 'group/source'). */
const _groupParents = new Map<string, string>()

/** Memoized section nodes — the manifest is static per build. */
let _groups: DocsNode[] | null = null

/**
 * Builds the four portal section nodes. The docs root's children flatten
 * straight into Documentation (the 'docs' bucket itself is not a tree
 * row — its URL stays reachable via crumbs/links); the `architecture`
 * subtree is promoted into its own Architecture Docs section. Source and
 * reports/coverage roots keep their bucket nodes as section members —
 * every member carries its real path, so /docs/<path> URLs never change.
 * @returns Ordered section nodes (empty sections dropped).
 */
const buildGroups = (): DocsNode[] => {
  const rootNode = (r: DocsRoot): DocsNode => ({
    type: 'dir',
    name: r.label,
    path: r.root,
    children: r.children,
  })

  const docsRoot = _manifest.roots.find((r) => r.kind === 'docs')

  const archNode = docsRoot?.children.find((c) => c.name === DOCS_STRINGS.ARCH_DIR)

  const defs: Array<[string, string, DocsNode[]]> = [
    [
      `${DOCS_STRINGS.GROUP_PATH_PREFIX}docs`,
      DOCS_STRINGS.GROUP_DOCS_LABEL,
      docsRoot ? docsRoot.children.filter((c) => c.name !== DOCS_STRINGS.ARCH_DIR) : [],
    ],
    [
      `${DOCS_STRINGS.GROUP_PATH_PREFIX}architecture`,
      DOCS_STRINGS.GROUP_ARCH_LABEL,
      archNode ? [archNode] : [],
    ],
    [
      `${DOCS_STRINGS.GROUP_PATH_PREFIX}source`,
      DOCS_STRINGS.GROUP_SOURCE_LABEL,
      _manifest.roots.filter((r) => r.kind === 'source').map(rootNode),
    ],
    [
      `${DOCS_STRINGS.GROUP_PATH_PREFIX}reports`,
      DOCS_STRINGS.GROUP_REPORTS_LABEL,
      _manifest.roots.filter((r) => r.kind === 'reports' || r.kind === 'coverage').map(rootNode),
    ],
  ]

  const groups: DocsNode[] = []

  for (const [path, name, children] of defs) {
    if (!children.length) continue

    for (const child of children) {
      _groupParents.set(child.path, path)
    }

    groups.push({ type: 'dir', name, path, children, group: true })
  }

  return groups
}

/**
 * The four section nodes that parent the flat manifest roots in the
 * treeview and the portal-root grid. Built once — the manifest never
 * changes after hydration.
 * @returns Ordered section dir-nodes flagged `group: true`.
 */
export const docsGroups = (): DocsNode[] => {
  _groups ??= buildGroups()

  return _groups
}

/**
 * The section-group path containing a manifest path — walks ancestors so
 * deep paths ('docs/sassdoc/index.html') resolve through their section
 * member ('docs/sassdoc') to the owning group ('group/docs'). Used to
 * auto-open the group row for a routed path and to climb Arrow-Left out
 * of a section member (its real path parent is not a rendered row).
 * @param path Manifest-relative docs path.
 * @returns The owning 'group/<id>' path, or undefined outside the tree.
 */
export const docsGroupParent = (path: string): string | undefined => {
  docsGroups()

  for (let p = path; p;) {
    const group = _groupParents.get(p)

    if (group) return group

    const cut = p.lastIndexOf(CHAR_STRINGS.SLASH)

    p = cut < 0 ? CHAR_STRINGS.EMPTY : p.slice(0, cut)
  }

  return undefined
}

/** ISO timestamp of the newest doc file — shown as "last docs update". */
export const docsGeneratedAt = (): string => _manifest.generated

/**
 * Whether a manifest root name ('src', 'core', …) is a protected source
 * bucket — source roots get the copy-guard and never auto-open index.html.
 * @param rootName First segment of a docs path or file id.
 * @returns True when the bucket's kind is 'source'.
 */
export const isSourceRoot = (rootName: string): boolean =>
  _manifest.roots.find((r) => r.root === rootName)?.kind === 'source'

/**
 * Extracts the root namespace from a manifest file id ('<root>:<rel>').
 * @param id Manifest file id.
 * @returns The root name, or '' when the id has no namespace.
 */
export const fileIdRoot = (id: string): string =>
  id.includes(CHAR_STRINGS.COLON) ? id.slice(0, id.indexOf(CHAR_STRINGS.COLON)) : CHAR_STRINGS.EMPTY

/**
 * Resolves a docs sub-path ('docs/a/b.md' or bare 'a/b' against roots) to
 * the manifest node. Case-sensitive — the tree mirrors the real fs layout.
 * @param docsPath Route param from /docs/<path>.
 * @returns The node, or null when the path doesn't resolve.
 */
export const resolveDocsPath = (docsPath: string): DocsNode | null => {
  if (!docsPath) return null

  const segments = docsPath.split(CHAR_STRINGS.SLASH).filter(Boolean)

  // Leading segment may name a root bucket ('docs/…'); when it doesn't,
  // search every root's top-level children so '/docs/architecture' can
  // still reach 'docs/architecture'.
  const matchedRoot = _manifest.roots.find((r) => r.root === segments[0])

  const rest = matchedRoot ? segments.slice(1) : segments

  // A bare root path ('/docs/docs') resolves to a synthetic dir node so
  // the grid/breadcrumb code treats it like any other folder.
  if (matchedRoot && !rest.length) {
    return {
      type: 'dir',
      name: matchedRoot.label,
      path: matchedRoot.root,
      children: matchedRoot.children,
    }
  }

  let nodes: DocsNode[] = matchedRoot
    ? matchedRoot.children
    : _manifest.roots.flatMap((r) => r.children)

  let cur: DocsNode | null = null

  for (const seg of rest) {
    const next = nodes.find((n) => n.name === seg) || null

    if (!next) return null

    cur = next
    nodes = next.children || []
  }

  return cur
}

/**
 * Breadcrumb segments for a resolved docs path — [{label, path}] from the
 * portal root down to the node.
 * @param docsPath Route param from /docs/<path>.
 * @returns Ordered crumb trail.
 */
export const crumbsForPath = (docsPath: string): Array<{ label: string; path: string }> => {
  const segments = (docsPath || CHAR_STRINGS.EMPTY).split(CHAR_STRINGS.SLASH).filter(Boolean)

  const crumbs: Array<{ label: string; path: string }> = []

  segments.forEach((seg, i) => {
    crumbs.push({ label: seg, path: segments.slice(0, i + 1).join(CHAR_STRINGS.SLASH) })
  })

  return crumbs
}

/**
 * Lazily fetches one rendered file payload. Ids come straight from the
 * manifest, so the URL is encoded segment-wise — never user-derived.
 * @param id Manifest file id ('<root>:<relpath>').
 * @returns Parsed payload, or null on 404/network failure.
 */
export const fetchDocsFile = async (id: string): Promise<DocsFilePayload | null> => {
  const rel = id.replace(CHAR_STRINGS.COLON, CHAR_STRINGS.SLASH)

  const url = `${DOCS_STRINGS.ASSET_BASE}${rel
    .split(CHAR_STRINGS.SLASH)
    .map(encodeURIComponent)
    .join(CHAR_STRINGS.SLASH)}${DOCS_STRINGS.ASSET_EXT}`

  try {
    const res = await fetch(url)

    if (!res.ok) return null

    return (await res.json()) as DocsFilePayload
  } catch {
    return null
  }
}
