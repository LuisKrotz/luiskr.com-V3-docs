/**
 * @file docs/render.tsx
 * @description JSX template for <view-docs> — extracted from Docs.tsx.
 * Pure render: header (title + last-update stamp), the GL strip canvas
 * behind the nav, the recursive treeview, editable breadcrumbs, the
 * folder grid, the file viewer and the legal footer. All interaction
 * delegates to the host component's methods.
 */

import { A11Y_CLASSES } from '@core/tokens/classes/a11y.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { HTML_PHRASING_TAGS, HTML_TAGS } from '@core/tokens/elements/html.js'
import { FORM_ATTRS } from '@core/tokens/attrs/form.js'
import { MICRODATA_ATTRS, MICRODATA_VALUES } from '@core/tokens/attrs/microdata.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { EXPAND_MODAL_CLASSES } from '@core/tokens/classes/modal.js'
import { PREF_CLASSES } from '@core/tokens/classes/preferences.js'
import { STATE_CLASSES } from '@core/tokens/classes/state.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { DOCS_STRINGS, DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { h } from '@core/jsx.js'
import { isPlainClick } from '@core/utils/dom.js'
import { ARROW_GLYPHS } from '@core/tokens/theme/arrows.js'
import { treeIcon } from './tree-icon.js'
import { crumbsForPath, docsGroups } from './manifest.js'
import type { ViewDocs } from './Docs.js'
import type { DocsNode } from './manifest.js'

/**
 * Absolute `/docs` route for a manifest-relative path — the canonical URL
 * every navigation surface (tree rows, grid cards, crumbs) carries as a
 * real href so crawlers, reader mode, and new-tab gestures all resolve.
 * @param subPath Manifest-relative path ('' → portal root).
 * @returns The portal-relative URL.
 */
const docsHref = (subPath: string): string =>
  subPath ? `${ROUTE_PATHS.DOCS}${CHAR_STRINGS.SLASH}${subPath}` : ROUTE_PATHS.DOCS

/**
 * Map-stage loading veil — status-labelled spinner + caption covering the
 * canvas seat while the scene's async graph build (worker layout →
 * geometry/label upload) runs. Both stage hosts (the column and the zoom
 * dialog) emit the identical subtree so the veil follows the persistent
 * canvas on a mid-build re-seat.
 */
const mapLoadingVeil = (): HTMLElement =>
  (
    <div className={DOCS_CLASSES.DOCS_MAP_LOADING} role={ARIA_ATTRS.ROLE_STATUS}>
      <span className={DOCS_CLASSES.DOCS_MAP_LOADING_SPIN} aria-hidden={ATTR_VALUES.TRUE} />
      <span className={DOCS_CLASSES.DOCS_MAP_LOADING_LABEL}>{DOCS_STRINGS.MAP_LOADING}</span>
    </div>
  ) as unknown as HTMLElement

/**
 * The URL a tree-row click actually lands on: an expanded dir the viewer
 * sits inside collapses UP one level, so its href mirrors the parent —
 * every other row maps to its own canonical /docs/<path>.
 * @param view The host docs view (reads docsPath for the inside check).
 * @param node The manifest node the row renders.
 * @param open Whether the dir row is currently expanded.
 * @returns The destination URL for the row's href.
 */
const treeHref = (view: ViewDocs, node: DocsNode, open: boolean): string => {
  const inside =
    view.docsPath === node.path || view.docsPath.startsWith(`${node.path}${CHAR_STRINGS.SLASH}`)

  if (open && inside)
    return docsHref(node.path.split(CHAR_STRINGS.SLASH).slice(0, -1).join(CHAR_STRINGS.SLASH))

  return docsHref(node.path)
}

/**
 * Recursive tree rows — each node renders a <li> with an anchor (dirs
 * toggle open AND navigate; files navigate). Real hrefs keep the tree
 * crawlable and give right-click/new-tab native semantics; plain clicks
 * stay on the SPA router. Children render inside a nested <ul> only
 * while the dir is in the host's open-set — per the self-similar
 * recursion rule the tree walks itself.
 */
const treeNodes = (view: ViewDocs, nodes: DocsNode[]): HTMLElement[] =>
  nodes.map((node) => {
    const open = view.isDirOpen(node.path)

    const active = view.docsPath === node.path

    const isDir = node.type === 'dir'

    /* Disclosure chevron — dirs carry the arrow (down = closed,
       up = expanded, rotated by CSS); files get an empty spacer
       so the icon column stays aligned across mixed rows. */
    const chevron = isDir ? (
      <svg
        className={DOCS_CLASSES.DOCS_TREE_CHEVRON}
        viewBox="0 0 12 12"
        aria-hidden={ATTR_VALUES.TRUE}
      >
        <path d="M3 4.4 L6 7.6 L9 4.4" />
      </svg>
    ) : (
      <i className={DOCS_CLASSES.DOCS_TREE_CHEVRON} aria-hidden={ATTR_VALUES.TRUE} />
    )

    return (
      <li key={node.path} role={ARIA_ATTRS.ROLE_NONE}>
        {node.group ? (
          // Section-group row — a disclosure-only treeitem: the sections
          // have no manifest route, so the row is a button (toggles the
          // member list) rather than a crawlable anchor.
          <button
            type={FORM_ATTRS.TYPE_BUTTON}
            role={ARIA_ATTRS.ROLE_TREEITEM}
            className={`${DOCS_CLASSES.DOCS_TREE_ITEM} ${DOCS_CLASSES.DOCS_TREE_GROUP}${open ? ` ${DOCS_CLASSES.DOCS_TREE_OPEN}` : CHAR_STRINGS.EMPTY}`}
            aria-expanded={String(open)}
            tabindex={view.treeTabIndex(node.path)}
            {...{ [DATA_ATTRS.DATA_PATH]: node.path }}
            onFocus={() => view.treeFocusItem(node.path)}
            onClick={() => view.toggleDir(node.path)}
          >
            {chevron}
            {treeIcon(node, open)}
            {node.name}
          </button>
        ) : (
          <a
            role={ARIA_ATTRS.ROLE_TREEITEM}
            href={treeHref(view, node, open)}
            className={`${DOCS_CLASSES.DOCS_TREE_ITEM}${open ? ` ${DOCS_CLASSES.DOCS_TREE_OPEN}` : CHAR_STRINGS.EMPTY}`}
            aria-expanded={isDir ? String(open) : undefined}
            aria-current={active ? 'page' : undefined}
            tabindex={view.treeTabIndex(node.path)}
            {...{ [DATA_ATTRS.DATA_PATH]: node.path }}
            onFocus={() => view.treeFocusItem(node.path)}
            onClick={(e: Event) => {
              // Modified/middle clicks keep native anchor semantics (new tab).
              if (!isPlainClick(e)) return

              e.preventDefault()

              view.pickTreeNode(node)
            }}
          >
            {chevron}
            {treeIcon(node, open)}
            {node.name}
          </a>
        )}
        {isDir && open && node.children?.length ? (
          <ul role={ARIA_ATTRS.ROLE_GROUP}>{treeNodes(view, node.children)}</ul>
        ) : null}
      </li>
    )
  }) as HTMLElement[]

/**
 * Grid cards — dirs and files get the generated folder SVG and navigate
 * into/open the node on click. Rendered as real anchors so the folder
 * grid is crawlable and new-tab gestures work natively; each card sits
 * inside an h3 so every listed document is a real heading AT heading-jump
 * (and crawlers) can enumerate.
 */
const gridCards = (
  view: ViewDocs,
  nodes: DocsNode[],
  headTag: string = HTML_TAGS.H3
): HTMLElement[] =>
  nodes.map((node) => {
    const isDir = node.type === 'dir'

    return h(
      headTag,
      { key: node.path, className: DOCS_CLASSES.DOCS_CARD_HEADING },
      <a
        href={docsHref(node.path)}
        className={DOCS_CLASSES.DOCS_CARD}
        {...{ [DATA_ATTRS.DATA_PATH]: node.path }}
        onClick={(e: Event) => {
          if (!isPlainClick(e)) return

          e.preventDefault()

          view.pickNode(node)
        }}
      >
        {/* Card art mirrors the treeview icon pack — same animated
              glyph vocabulary (folder sheets / kind pack) at card size. */}
        <span className={DOCS_CLASSES.DOCS_CARD_ART}>
          {treeIcon(node, isDir && view.isDirOpen(node.path))}
        </span>
        <span className={DOCS_CLASSES.DOCS_CARD_LABEL}>{node.name}</span>
      </a>
    )
  }) as HTMLElement[]

// ─── Complete document index ─────────────────────────────────────────────────
// The manifest is static per build, so the index DOM is built once and the
// same node is re-attached on every render. Every manifest node stays linked —
// dirs carry the headings (the navigable map) while files mount as bare
// anchors: a heading per document made the map itself unusable (~8k headings).
// Perf shape, end to end:
//  - Anchors carry `data-path` and ONE delegated click listener lives on the
//    nav — ~8k per-node closures/listeners never exist.
//  - `tabindex="-1"` keeps the thousands of index links out of sequential tab
//    order (AT still enumerates them via headings/links lists and the virtual
//    cursor; Tab through them would be unusable).
//  - Slices append into a detached DocumentFragment and the fragment attaches
//    ONCE — no live-DOM style/layout is paid per slice, and the finished nav
//    is `content-visibility: auto` parked offscreen, so the subtree stays in
//    the AX tree + DOM for AT/crawlers while style/layout/paint are skipped
//    permanently.

/** The view the memoized index links delegate navigation to. */
let _indexView: ViewDocs | null = null

/** The built-once index subtree (all manifest nodes as heading/link rows). */
let _indexEl: HTMLElement | null = null

/**
 * Index link for one manifest node — a real /docs/<path> anchor (crawlable,
 * new-tab friendly) carrying its path for the nav's delegated click handler.
 * `tabindex="-1"` keeps it out of sequential focus (see block comment).
 * @param path Manifest-relative path the link navigates to.
 * @param label Anchor text (node name / bucket label).
 * @returns The anchor element.
 */
const indexLink = (path: string, label: string): HTMLElement =>
  h(
    'a',
    {
      href: docsHref(path),
      tabindex: ATTR_VALUES.NEGATIVE_TABINDEX,
      ...{ [DATA_ATTRS.DATA_PATH]: path },
    },
    label
  ) as HTMLElement

/**
 * Recursive index entries — dirs yield a heading wrapping their canonical
 * link (level 3 + depth capped at h6, so the ladder mirrors the tree:
 * bucket h3 → h4 → h5 → h6), files yield the bare anchor. The links land
 * in document order directly under the nav: each file's anchor reads as
 * belonging to the preceding dir heading, keeping every document reachable
 * from both the AX tree and crawlers without a heading per file.
 * @param nodes The manifest nodes at this depth.
 * @param depth 1-based depth below the bucket heading.
 * @yields Heading elements (dirs) and anchor elements (files) in order.
 */
/** Heading tag ladder for index depths 1–4 (h4→h6 capped — deeper stays h6). */
const _INDEX_HEADS = [HTML_PHRASING_TAGS.H4, HTML_PHRASING_TAGS.H5, HTML_PHRASING_TAGS.H6] as const

function* indexNodes(nodes: DocsNode[], depth: number): Generator<HTMLElement> {
  for (const node of nodes) {
    if (node.type === 'dir') {
      yield h(
        _INDEX_HEADS[Math.min(depth, _INDEX_HEADS.length) - 1],
        null,
        indexLink(node.path, node.name)
      ) as HTMLElement

      if (node.children?.length) yield* indexNodes(node.children, depth + 1)
    } else {
      yield indexLink(node.path, node.name)
    }
  }
}

/**
 * Streams the section groups + member subtrees — an h3 label per group
 * (sections are disclosure-only, so the heading carries no link), then
 * each member's nodes in document order (dirs as heading links one level
 * under the group, files as bare anchors). Generator shape per the
 * self-similar-traversal rule; the puller controls pacing.
 * @param groups The four section nodes parenting the manifest roots.
 * @yields Index elements in document order.
 */
function* indexEntries(groups: DocsNode[]): Generator<HTMLElement> {
  for (const group of groups) {
    yield h(HTML_TAGS.H3, null, group.name) as HTMLElement

    yield* indexNodes(group.children as DocsNode[], 1)
  }
}

/**
 * Schedules one index slice in the next idle gap — requestIdleCallback
 * with a starvation bound where it exists, a bare setTimeout otherwise.
 * The timeout guarantees the tree completes even on a continuously busy
 * main thread.
 * @param cb The slice to run.
 */
const scheduleIndexSlice = (cb: () => void): void => {
  if (
    typeof window !== TYPE_STRINGS.UNDEFINED &&
    typeof window.requestIdleCallback === TYPE_STRINGS.FUNCTION
  ) {
    window.requestIdleCallback(cb, { timeout: DOCS_UNITS.INDEX_IDLE_TIMEOUT })
  } else {
    setTimeout(cb, DOCS_UNITS.INDEX_FALLBACK_DELAY)
  }
}

/**
 * Pulls INDEX_CHUNK elements per slice into a DETACHED DocumentFragment —
 * each slice is pure createElement work with zero style/layout cost since
 * the fragment is not connected. On completion the whole tree attaches to
 * the nav in ONE insertion, so the multi-thousand-node layout pass happens
 * once (and with the nav's content-visibility skip, barely even then).
 * Runs to completion regardless of view lifetime: the element is memoized
 * module-level and re-attaches on the next render.
 * @param gen The index element stream.
 * @param nav The index nav the finished fragment attaches to.
 * @param frag Detached fragment accumulating nodes between slices.
 */
const pumpIndex = (gen: Generator<HTMLElement>, nav: HTMLElement, frag: DocumentFragment): void => {
  for (let i = 0; i < DOCS_UNITS.INDEX_CHUNK; i++) {
    const next = gen.next()

    if (next.done) {
      nav.appendChild(frag)

      return
    }

    frag.appendChild(next.value)
  }

  scheduleIndexSlice(() => pumpIndex(gen, nav, frag))
}

/**
 * The complete document index — an sr-only nav listing every manifest node
 * (dirs as heading links, files as bare anchors) so AT heading navigation
 * gets the tree's shape and link navigation/crawlers/agents reach all docs
 * without unfolding the tree. The nav shell mounts synchronously; the
 * ~8k-node body streams in over idle slices so first paint and input
 * tasks never pay the full attach. Memoized — re-attached on subsequent
 * renders; real DOM so crawlers index it.
 * @param view The host view (links delegate navigation to it).
 * @returns The memoized index nav element.
 */
const docsIndex = (view: ViewDocs): HTMLElement => {
  _indexView = view

  if (!_indexEl) {
    _indexEl = h(
      'nav',
      {
        className: `${A11Y_CLASSES.SR_ONLY} ${DOCS_CLASSES.DOCS_INDEX}`,
        'aria-label': DOCS_STRINGS.INDEX_LABEL,
        // One delegated handler for every index link — closest() resolves
        // the clicked anchor and data-path carries its manifest path.
        onClick: (e: Event) => {
          if (!isPlainClick(e)) return

          const anchor = (e.target as HTMLElement).closest(HTML_TAGS.A)
          const path = anchor?.getAttribute(DATA_ATTRS.DATA_PATH)

          if (!path) return

          e.preventDefault()

          _indexView?.navigateDocs(path)
        },
      },
      h('h2', null, DOCS_STRINGS.INDEX_TITLE)
    ) as HTMLElement

    scheduleIndexSlice(() =>
      pumpIndex(indexEntries(docsGroups()), _indexEl!, document.createDocumentFragment())
    )
  }

  return _indexEl
}

/**
 * Editable breadcrumb strip — each crumb is a jump-to link; the trailing
 * input carries the full relative path and commits on Enter (Escape
 * restores the current path).
 */
/**
 * The crumb anchors + editable path input — shared by the desktop crumb
 * bar and the ≤1280px combobox dropdown (tree + breadcrumb merge into
 * one control there). Rendered once per surface so the edit field keeps
 * the same contract in both.
 */
const crumbLinks = (view: ViewDocs) => {
  const crumbs = crumbsForPath(view.docsPath)

  return [
    <a
      key={CHAR_STRINGS.EMPTY}
      href={docsHref(CHAR_STRINGS.EMPTY)}
      className={DOCS_CLASSES.DOCS_CRUMB}
      onClick={(e: Event) => {
        if (!isPlainClick(e)) return

        e.preventDefault()

        view.navigateDocs(CHAR_STRINGS.EMPTY)
      }}
    >
      {DOCS_STRINGS.TITLE}
    </a>,
    ...crumbs.map((c) => (
      <a
        key={c.path}
        href={docsHref(c.path)}
        className={DOCS_CLASSES.DOCS_CRUMB}
        onClick={(e: Event) => {
          if (!isPlainClick(e)) return

          e.preventDefault()

          view.navigateDocs(c.path)
        }}
      >
        {c.label}
      </a>
    )),
    <input
      key={DOCS_STRINGS.CRUMB_INPUT_NAME}
      className={DOCS_CLASSES.DOCS_CRUMB_EDIT}
      aria-label={DOCS_STRINGS.CRUMB_INPUT_LABEL}
      title={DOCS_STRINGS.CRUMB_INPUT_HINT}
      placeholder={DOCS_STRINGS.CRUMB_PLACEHOLDER}
      name={DOCS_STRINGS.CRUMB_INPUT_NAME}
      value={`${CHAR_STRINGS.SLASH}${view.docsPath}`}
      onKeydown={(e: Event) => view.onCrumbKey(e as KeyboardEvent)}
      onFocus={(e: Event) => (e.target as HTMLInputElement).select()}
    />,
  ]
}

/**
 * Editable breadcrumb strip — each crumb is a jump-to link; the trailing
 * input carries the full relative path and commits on Enter (Escape
 * restores the current path).
 */
const crumbBar = (view: ViewDocs) => (
  <nav className={DOCS_CLASSES.DOCS_CRUMBS} aria-label={DOCS_STRINGS.TITLE}>
    {crumbLinks(view)}
  </nav>
)

/** The docs template — assembled for ViewDocs.render(). */
export const renderDocs = (view: ViewDocs) => {
  const node = view.node

  const isRoot = !view.docsPath

  // Portal root lists the four section groups; a dir lists its children.
  const sections = isRoot ? view.rootsAsNodes() : []

  const children = isRoot ? [] : node?.type === 'dir' ? node.children || [] : []

  const generated = view.generatedAt()

  // In-DOM microdata mirrors the JSON-LD graph (_applyPath → updateJsonLd):
  // TechArticle while a file is open, CollectionPage otherwise.
  const isFilePage = view.node?.type === 'file'

  return (
    <div
      className={`${DOCS_CLASSES.DOCS}${view.navOpen ? ` ${DOCS_CLASSES.DOCS_NAV_OPEN}` : CHAR_STRINGS.EMPTY}`}
      onKeydown={(e: Event) => view.onViewKey(e as KeyboardEvent)}
      {...{
        [MICRODATA_ATTRS.ITEMSCOPE]: CHAR_STRINGS.EMPTY,
        [MICRODATA_ATTRS.ITEMTYPE]: isFilePage
          ? MICRODATA_VALUES.TYPE_TECH_ARTICLE
          : MICRODATA_VALUES.TYPE_COLLECTION_PAGE,
      }}
    >
      {/* Docs boot loader — stays up until the portal's first usable
          state (manifest resolved, scene mount attempted, any in-flight
          file payload settled); mirrors the space playground's system
          boot overlay with docs-context stage copy. */}
      {!view._docsReady && (
        <div className={DOCS_CLASSES.DOCS_LOADER} aria-hidden="true">
          <div className={DOCS_CLASSES.DOCS_LOADER_GLOW} />
          <div className={DOCS_CLASSES.DOCS_LOADER_GRID} />
          <div className={DOCS_CLASSES.DOCS_LOADER_CONTENT}>
            <div className={DOCS_CLASSES.DOCS_LOADER_SPINNER_OUTER} />
            <div className={DOCS_CLASSES.DOCS_LOADER_SPINNER_INNER} />
            <div className={DOCS_CLASSES.DOCS_LOADER_COUNTER}>
              <span className={DOCS_CLASSES.DOCS_LOADER_PERCENT}>
                <span className={DOCS_CLASSES.DOCS_LOADER_VAL}>{view._loaderPct}</span>
                <span className={DOCS_CLASSES.DOCS_LOADER_SYM}>{CHAR_STRINGS.PERCENT}</span>
              </span>
            </div>
            <div className={DOCS_CLASSES.DOCS_LOADER_TITLE}>{DOCS_STRINGS.LOADER_TITLE}</div>
            <div className={DOCS_CLASSES.DOCS_LOADER_MSG}>{view._loaderMsg}</div>
            <div className={DOCS_CLASSES.DOCS_LOADER_BAR}>
              <div
                className={DOCS_CLASSES.DOCS_LOADER_BAR_FILL}
                style={`width:${view._loaderPct}${CHAR_STRINGS.PERCENT}`}
              />
            </div>
          </div>
        </div>
      )}

      <canvas id={DOCS_IDS.GL} className={DOCS_CLASSES.DOCS_GL} aria-hidden="true" />

      <header className={DOCS_CLASSES.DOCS_HEADER}>
        <h1
          className={DOCS_CLASSES.DOCS_TITLE}
          {...{ [MICRODATA_ATTRS.ITEMPROP]: MICRODATA_VALUES.PROP_NAME }}
        >
          {DOCS_STRINGS.TITLE}
        </h1>
        <time
          className={DOCS_CLASSES.DOCS_UPDATED}
          dateTime={generated}
          {...{ [MICRODATA_ATTRS.ITEMPROP]: MICRODATA_VALUES.PROP_DATE_MODIFIED }}
        >
          {generated}
        </time>
      </header>

      <div className={DOCS_CLASSES.DOCS_BODY}>
        {/* Stack wrapper — 1025–1280 it is the left grid cell carrying
            nav + content vertically while the map owns column 2; ≥1281
            display:contents dissolves it so nav/main/map become three
            sibling columns of the body grid. */}
        <div className={DOCS_CLASSES.DOCS_STACK}>
          {/* Combobox navigation — ≤1280px the tree and the breadcrumb
            merge into one disclosure control: the button face carries
            the current path (the breadcrumb collapsed), the dropdown
            panel keeps the full crumb row + editable input above the
            treeview. ≥1281px the panel is always open as the left
            column and the button/hidden-crumbs bow out via CSS. */}
          <nav className={DOCS_CLASSES.DOCS_NAV} aria-label={DOCS_STRINGS.TREE_LABEL}>
            <button
              type={FORM_ATTRS.TYPE_BUTTON}
              className={DOCS_CLASSES.DOCS_NAV_TOGGLE}
              aria-expanded={String(view.navOpen)}
              aria-controls={DOCS_IDS.NAV_PANEL}
              onClick={() => view.toggleNav()}
            >
              {/* Combobox face — the merged breadcrumb: root label +
                each crumb of the current location. */}
              {[DOCS_STRINGS.TITLE, ...crumbsForPath(view.docsPath).map((c) => c.label)].join(
                ` ${CHAR_STRINGS.SLASH} `
              )}
            </button>
            <div className={DOCS_CLASSES.DOCS_NAV_PANEL} id={DOCS_IDS.NAV_PANEL}>
              {/* The breadcrumb merged into the dropdown — hidden ≥1281
                where the bar above the content column owns the role. */}
              <div className={DOCS_CLASSES.DOCS_NAV_CRUMBS}>{crumbLinks(view)}</div>
              <h2 className={A11Y_CLASSES.SR_ONLY}>{DOCS_STRINGS.TREE_LABEL}</h2>
              <ul
                className={DOCS_CLASSES.DOCS_TREE}
                id={DOCS_IDS.TREE}
                role={ARIA_ATTRS.ROLE_TREE}
                aria-label={DOCS_STRINGS.TREE_LABEL}
                onKeydown={(e: Event) => view.onTreeKey(e as KeyboardEvent)}
              >
                {treeNodes(view, view.rootsAsNodes())}
              </ul>
            </div>
          </nav>

          <section className={DOCS_CLASSES.DOCS_MAIN} aria-label={DOCS_STRINGS.MAIN_LABEL}>
            {/* Region heading — the current folder's own name so the h2 is
              meaningful ('docs', 'coverage-core'…), not a generic label. */}
            <h2 className={A11Y_CLASSES.SR_ONLY}>
              {isRoot ? DOCS_STRINGS.MAIN_LABEL : node?.name || view.docsPath}
            </h2>

            {crumbBar(view)}

            {view.filePayload || view.fileLoading ? (
              <section
                className={`${DOCS_CLASSES.DOCS_VIEWER}${view.isProtectedView() ? ` ${DOCS_CLASSES.DOCS_PROTECTED}` : CHAR_STRINGS.EMPTY}`}
                id={DOCS_IDS.VIEWER}
              >
                <div className={DOCS_CLASSES.DOCS_VIEWER_HEAD}>
                  {/* Square glyph button — the project's hairline-corner
                      control pattern (same shape as the map zoom). */}
                  <button
                    type={FORM_ATTRS.TYPE_BUTTON}
                    className={DOCS_CLASSES.DOCS_VIEWER_BACK}
                    aria-label={DOCS_STRINGS.VIEWER_BACK}
                    title={DOCS_STRINGS.VIEWER_BACK}
                    onClick={() => view.closeFile()}
                  >
                    {ARROW_GLYPHS.PREV}
                  </button>
                  {/* The open file is a real heading — AT heading-jump lands
                    on the document being read. */}
                  <h2 className={A11Y_CLASSES.SR_ONLY}>{view.node?.name || view.docsPath}</h2>
                  <span
                    className={DOCS_CLASSES.DOCS_VIEWER_PATH}
                    {...{ [MICRODATA_ATTRS.ITEMPROP]: MICRODATA_VALUES.PROP_URL }}
                  >
                    {view.docsPath}
                  </span>
                </div>
                <div
                  className={DOCS_CLASSES.DOCS_CONTENT}
                  {...{ [MICRODATA_ATTRS.ITEMPROP]: MICRODATA_VALUES.PROP_ARTICLE_BODY }}
                />
              </section>
            ) : null}

            {isRoot ? (
              sections.length ? (
                <div
                  className={DOCS_CLASSES.DOCS_GRID}
                  id={DOCS_IDS.GRID}
                  role={ARIA_ATTRS.ROLE_REGION}
                  aria-label={DOCS_STRINGS.GRID_LABEL}
                  onKeydown={(e: Event) => view.onGridKey(e as KeyboardEvent)}
                >
                  {sections.map((g) => (
                    <section
                      key={g.path}
                      className={DOCS_CLASSES.DOCS_GRID_GROUP}
                      aria-label={g.name}
                    >
                      {/* h3 group head → h4 cards keeps the heading ladder
                          honest under the h2 region label. */}
                      <h3 className={DOCS_CLASSES.DOCS_GRID_GROUP_HEAD}>{g.name}</h3>
                      {gridCards(view, g.children as DocsNode[], HTML_PHRASING_TAGS.H4)}
                    </section>
                  ))}
                </div>
              ) : null
            ) : children.length ? (
              <div
                className={DOCS_CLASSES.DOCS_GRID}
                id={DOCS_IDS.GRID}
                role={ARIA_ATTRS.ROLE_REGION}
                aria-label={DOCS_STRINGS.GRID_LABEL}
                onKeydown={(e: Event) => view.onGridKey(e as KeyboardEvent)}
              >
                {gridCards(view, children)}
              </div>
            ) : null}

            {!node && !isRoot ? (
              <p className={DOCS_CLASSES.DOCS_UPDATED}>{DOCS_STRINGS.NOT_FOUND_PATH}</p>
            ) : null}

            {/* Complete document index — every manifest node as a heading
              link; memoized DOM, re-attached each render. */}
            {docsIndex(view)}
          </section>
        </div>

        {/* Interactive file cloud — the alternative nav surface:
            a right-hand column on ≥1025px (hidden under it), orbit/pinch
            on the persistent scene canvas, tap-to-pick navigates. The
            zoom trigger re-seats the SAME canvas into the centered glass
            dialog — no context loss, no remount. */}
        <aside className={DOCS_CLASSES.DOCS_MAP} aria-labelledby={DOCS_IDS.MAP_LABEL}>
          <div className={DOCS_CLASSES.DOCS_MAP_HEAD}>
            <span className={DOCS_CLASSES.DOCS_SCENE_HINT} id={DOCS_IDS.MAP_LABEL}>
              {DOCS_STRINGS.SCENE_HINT}
            </span>
            <button
              type={FORM_ATTRS.TYPE_BUTTON}
              className={DOCS_CLASSES.DOCS_MAP_ZOOM}
              aria-label={DOCS_STRINGS.MAP_ZOOM}
              aria-expanded={String(view._mapZoomed)}
              // The modal id only exists while zoomed — pointing
              // aria-controls at a not-yet-rendered element trips
              // aria_id_unique/aria-controls-validity checks.
              aria-controls={view._mapZoomed ? DOCS_IDS.MAP_MODAL : undefined}
              onClick={() => view.toggleMapZoom()}
            >
              <span className={DOCS_CLASSES.DOCS_MAP_ZOOM_ICON} aria-hidden={ATTR_VALUES.TRUE}>
                {CHAR_STRINGS.EXPAND_GLYPH}
              </span>
            </button>
          </div>
          {!view._mapZoomed && (
            <div className={DOCS_CLASSES.DOCS_MAP_STAGE}>
              {view._sceneLoading ? mapLoadingVeil() : null}
            </div>
          )}
        </aside>

        {/* Map zoom dialog — glass overlay centering the enlarged scene;
            the stage hosts the same persistent canvas while open. Chrome
            follows the expand-modal pattern: a fullscreen close-area
            click-catcher, the close-bar's circular pref-close canvas
            button (CloseButtonWebGL mounts on it in onUpdated; the CSS X
            fallback span stays authoritative on no-GL contexts), and a
            labelled close-bottom under the dialog content. */}
        {view._mapZoomed && (
          <div className={DOCS_CLASSES.DOCS_MAP_MODAL}>
            <div className={DOCS_CLASSES.DOCS_MAP_CLOSE_AREA} onClick={() => view.closeMapZoom()} />
            <div
              className={DOCS_CLASSES.DOCS_MAP_DIALOG}
              id={DOCS_IDS.MAP_MODAL}
              role={ARIA_ATTRS.ROLE_DIALOG}
              aria-modal={ATTR_VALUES.TRUE}
              aria-label={DOCS_STRINGS.MAP_LABEL}
            >
              <div className={DOCS_CLASSES.DOCS_MAP_HEAD}>
                <span className={DOCS_CLASSES.DOCS_SCENE_HINT}>{DOCS_STRINGS.SCENE_HINT}</span>
                <button
                  type={FORM_ATTRS.TYPE_BUTTON}
                  className={PREF_CLASSES.PREF_CLOSE_BTN}
                  aria-label={DOCS_STRINGS.MAP_CLOSE}
                  onClick={() => view.closeMapZoom()}
                >
                  <canvas
                    className={`${PREF_CLASSES.PREF_CLOSE_CANVAS} ${STATE_CLASSES.IS_FALLBACK}`}
                    aria-hidden={ATTR_VALUES.TRUE}
                  />
                  <span
                    className={EXPAND_MODAL_CLASSES.EXPAND_MODAL_CLOSE_BAR_FALLBACK}
                    aria-hidden={ATTR_VALUES.TRUE}
                  />
                </button>
              </div>
              <div className={DOCS_CLASSES.DOCS_MAP_STAGE}>
                {view._sceneLoading ? mapLoadingVeil() : null}
              </div>
              <button
                type={FORM_ATTRS.TYPE_BUTTON}
                className={DOCS_CLASSES.DOCS_MAP_CLOSE_BOTTOM}
                onClick={() => view.closeMapZoom()}
              >
                {DOCS_STRINGS.MAP_CLOSE}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  ) as unknown as HTMLElement
}
