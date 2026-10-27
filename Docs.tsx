/**
 * @file docs/Docs.tsx
 * @description <view-docs> — the English-only docs portal route.
 *
 * Renders the docs/reports/coverage/src manifest as a browsable portal:
 * recursive treeview, editable breadcrumbs, generated folder artwork,
 * on-demand file payloads (/docs-content/*.json) rendered as HTML — plus
 * the WebGL nav backdrop, the three.js architecture scene on the portal
 * root, and the copy-protection layer on source-code pages.
 *
 * The manifest comes from `virtual:docs-manifest` (build-time scan); file
 * payloads arrive lazily so thousands of documents never load at once.
 */

import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { PREF_CLASSES } from '@core/tokens/classes/preferences.js'
import { READER_CLASSES } from '@core/tokens/classes/reader.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { KEYS, MEDIA_QUERIES } from '@core/tokens/primitives.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { DOCS_LOADER_PCT, DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { BaseComponent } from '@core/Component.js'
import store from '@core/store.js'
import { componentText } from '@core/locale/ui-text.js'
import { devWarn } from '@core/devlog.js'
import { applyAnimationDesc } from '@core/utils/a11y/animation-desc.js'
import { ANIMATION_DURATIONS } from '@core/tokens/motion/animation.js'
import { ANIMATION_IDS } from '@core/tokens/data/animation-ids.js'
import { CloseButtonWebGL } from '@core/utils/canvas/widgets/close-button.js'
import { generateDocsSchema, updateJsonLd } from '@core/utils/schema.js'
import { isPlainClick } from '@core/utils/dom.js'
import { BASE_TITLE } from '@core/tokens/routes.js'
import router from '@core/router/router.js'
import type { RouteDescriptor } from '@core/router/router.js'
import {
  getDocsManifest,
  resolveDocsPath,
  fetchDocsFile,
  isSourceRoot,
  fileIdRoot,
  docsGroups,
  docsGroupParent,
  type DocsNode,
  type DocsFilePayload,
} from './manifest.js'
import { FORM_EVENTS, GL_EVENTS, MOUSE_EVENTS, PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { renderDocs } from './render.js'
import { mountDocsGlStrip, type DocsGlHandle } from './gl-strip.js'
import { mountArchScene, type ArchSceneHandle } from './arch-scene.js'
import { attachCopyGuard, type GuardDisposer } from './copy-guard.js'
import { attachCoverageNav } from './coverage-nav.js'
import { renderMermaidBlocks } from './mermaid.js'
import { dismissDocsLoader, updateDocsLoader } from './loader.js'
import docsStyles from './docs.scss?inline'

/**
 * The ViewDocs — docs portal route element.
 */
export class ViewDocs extends BaseComponent {
  /** Current '/docs/<path>' suffix from the route param. */
  docsPath: string = CHAR_STRINGS.EMPTY

  /** Resolved manifest node for docsPath (null at the portal root). */
  node: DocsNode | null = null

  /** Open file payload state. */
  filePayload: DocsFilePayload | null = null

  /** File fetch in flight. */
  fileLoading = false

  /** Dirs the treeview shows expanded. */
  private _openDirs = new Set<string>()

  /** Mobile nav-panel open state (the tree collapses under a toggle <1024). */
  navOpen = false

  /** Architecture-map zoom modal — the persistent scene canvas re-seats
   *  into the centered glass dialog while open. */
  _mapZoomed = false

  /**
   * The dialog's animated close button — a CloseButtonWebGL mounted on
   * the pref-close canvas each render that produces a fresh dialog. The
   * widget binds click on the parent button; the DOM onClick does the
   * same, so closeMapZoom must stay idempotent (double-fire safe).
   */
  private _mapCloseBtn: CloseButtonWebGL | null = null

  /**
   * Focus hand-off consumed by onUpdated: opening the zoom dialog puts
   * focus on its close button (the expand-modal pattern), closing it
   * returns focus to the map column's zoom trigger.
   */
  private _mapFocus: 'open' | 'close' | null = null

  /**
   * Path whose tree/grid button regains focus after the next re-render —
   * arrow-key expand/collapse re-creates the DOM, so focus would
   * otherwise drop to the body.
   */
  private _focusPath: string | null = null

  /**
   * The treeview's roving tab stop — path of the single tabindex="0"
   * row. APG trees take ONE tab stop: Tab enters the widget once,
   * arrows move inside it. Every other row carries tabindex="-1" so
   * keyboard users aren't forced through thousands of links.
   */
  private _treeTabPath: string | null = null

  private _guardDispose: GuardDisposer | null = null

  private _glHandle: DocsGlHandle | null = null

  private _glCanvas: HTMLCanvasElement | null = null

  private _sceneHandle: ArchSceneHandle | null = null

  private _sceneCanvas: HTMLCanvasElement | null = null

  /**
   * Map-column visibility watcher — ≤1024 the aside is display:none and
   * the scene's rAF loop is paused so hidden canvases cost zero GPU.
   * The zoom dialog overrides the pause (the modal can open at any
   * width once the column control exists… but the column only renders
   * >1024, so the dialog is reachable only there — the listener still
   * keeps the paused flag honest across resizes).
   */
  private _mapMq: MediaQueryList | null = null

  /** Bound change handler for _mapMq — removed in onDestroy. */
  private _onMapMq = (): void => this._syncScenePaused()

  /** Document-level istanbul key-nav disposer while a report is open. */
  private _covNavDispose: (() => void) | null = null

  /**
   * Boot-loader lifecycle — the overlay stays up until the portal's first
   * usable state: manifest resolved, the architecture scene mount
   * attempted (success or WebGL fallback), and any in-flight file payload
   * settled. Mirrors the space playground's `_earthReady` contract.
   */
  _docsReady = false

  /** Current boot stage copy + percent rendered inside the loader. */
  _loaderMsg: string = DOCS_STRINGS.LOADER_MSG_INIT
  _loaderPct = 0

  /**
   * Scene-graph build state — true while the worker-computed layout →
   * mesh/label upload is in flight (initial mount AND context-restore
   * remounts). The map stage's loading veil renders on this flag and is
   * dismissed imperatively on the scene's ready/lost signal so a slow
   * build never reads as a blank black box.
   */
  _sceneLoading = true

  constructor() {
    super(docsStyles)
  }

  /** Section nodes parenting the manifest roots — memoized; the group
   *  rows seed open so the grouped tree lands with its members visible
   *  like the flat list it replaced. */
  private _sectionNodes: DocsNode[] | null = null

  /** Manifest roots grouped under the four section nodes for the
   *  treeview and the portal-root grid. */
  rootsAsNodes(): DocsNode[] {
    if (!this._sectionNodes) {
      this._sectionNodes = docsGroups()

      for (const g of this._sectionNodes) {
        this._openDirs.add(g.path)
      }
    }

    return this._sectionNodes
  }

  /** ISO generated stamp shown under the title. */
  generatedAt(): string {
    return getDocsManifest().generated
  }

  /** Whether a dir path is expanded in the treeview. */
  isDirOpen(path: string): boolean {
    return this._openDirs.has(path)
  }

  /**
   * Roving tabindex for a rendered tree row — '0' only on the current
   * tab-stop path so the treeview exposes exactly one Tab entry per the
   * ARIA treeview pattern (IBM widget_tabbable_single).
   * @param path Manifest path of the row being rendered.
   */
  treeTabIndex(path: string): string {
    return path === this._treeTabPath ? ATTR_VALUES.TABINDEX_ZERO : ATTR_VALUES.NEGATIVE_TABINDEX
  }

  /**
   * Focus landed on a tree row (arrow move, click-focus, or the
   * _focusPath restore): make it the widget's single tab stop by
   * flipping tabindex across the live rows — an attribute flip, not a
   * re-render, so focus never churns mid-gesture.
   * @param path Manifest path of the focused row.
   */
  treeFocusItem(path: string): void {
    this._treeTabPath = path

    for (const btn of this._treeButtons()) {
      btn.setAttribute(
        ARIA_ATTRS.TABINDEX,
        btn.getAttribute(DATA_ATTRS.DATA_PATH) === path
          ? ATTR_VALUES.TABINDEX_ZERO
          : ATTR_VALUES.NEGATIVE_TABINDEX
      )
    }
  }

  /** Whether the open file sits under a protected source-module root. */
  isProtectedView(): boolean {
    return (
      this.filePayload !== null && isSourceRoot(fileIdRoot(this.node?.id || CHAR_STRINGS.EMPTY))
    )
  }

  /** Localized toast copy for the copy guard — componentText already English-falls-back. */
  private _toastText = (): string =>
    String(componentText(`${DOCS_STRINGS.CMS_COMPONENT}.copyToast`))

  /**
   * Navigates within the portal — a bare path resolves against /docs.
   * @param subPath Manifest-relative path ('' → portal root).
   */
  navigateDocs(subPath: string): void {
    void router.push(
      subPath ? `${ROUTE_PATHS.DOCS}${CHAR_STRINGS.SLASH}${subPath}` : ROUTE_PATHS.DOCS
    )
  }

  /**
   * Grid/tree click — dirs toggle expansion AND navigate so the grid lands
   * on the folder; files navigate straight to their file route.
   * Section-group nodes have no route — they only toggle disclosure.
   */
  pickNode(node: DocsNode): void {
    if (node.group) {
      this.toggleDir(node.path)

      return
    }

    if (node.type === 'dir') this._openDirs.add(node.path)

    this.navigateDocs(node.path)
  }

  /**
   * Tree-row click — clicking an already-expanded dir collapses it (and,
   * when the viewer sits inside that folder, navigates back to its parent
   * so the page state matches the collapsed tree); a closed dir expands
   * and navigates; files navigate.
   */
  pickTreeNode(node: DocsNode): void {
    if (node.type !== 'dir' || !this._openDirs.has(node.path)) {
      this.pickNode(node)

      return
    }

    this._openDirs.delete(node.path)

    const inside =
      this.docsPath === node.path || this.docsPath.startsWith(`${node.path}${CHAR_STRINGS.SLASH}`)

    if (inside) {
      const parent = node.path.split(CHAR_STRINGS.SLASH).slice(0, -1).join(CHAR_STRINGS.SLASH)

      this.navigateDocs(parent)
    } else {
      this._updateDom()
    }
  }

  /**
   * Back button — navigates to the file's parent folder (or the root).
   * A non-source index.html IS the folder's open state: its parent dir
   * re-opens it on entry (_applyPath), so back must climb past the
   * owning dir to the grandparent — otherwise the button loops on the
   * same file. Under source roots index.html is a plain file: one level.
   */
  closeFile(): void {
    const segments = this.docsPath.split(CHAR_STRINGS.SLASH)

    const isAutoIndex =
      this.node?.type === 'file' &&
      this.node.name === DOCS_STRINGS.INDEX_FILE &&
      !isSourceRoot(segments[0] as string)

    const parent = segments.slice(0, isAutoIndex ? -2 : -1).join(CHAR_STRINGS.SLASH)

    this.navigateDocs(parent)
  }

  /** Mobile "browse" toggle — shows/hides the tree panel on small screens. */
  toggleNav(): void {
    this.navOpen = !this.navOpen

    this._updateDom()
  }

  /**
   * Map zoom open — the dialog's first-focusable is its close button
   * (expand-modal pattern: AT/keyboard reach the dismiss affordance
   * first). The scene canvas re-seats into the dialog stage on the next
   * render pass — no context loss, no remount.
   */
  openMapZoom(): void {
    if (this._mapZoomed) return

    this._mapZoomed = true
    this._mapFocus = 'open'

    this._updateDom()
  }

  /**
   * Map zoom close — idempotent: the close button fires this from both
   * its DOM click and the widget's own listener on the same gesture.
   * Returns focus to the zoom trigger.
   */
  closeMapZoom(): void {
    if (!this._mapZoomed) return

    this._mapZoomed = false
    this._mapFocus = 'close'

    this._updateDom()
  }

  /** Zoom trigger — toggles the dialog (delegates to the explicit arms). */
  toggleMapZoom(): void {
    if (this._mapZoomed) this.closeMapZoom()
    else this.openMapZoom()
  }

  /** Expands or collapses a dir in place (keyboard left/right) without navigating. */
  toggleDir(path: string): void {
    if (this._openDirs.has(path)) this._openDirs.delete(path)
    else this._openDirs.add(path)

    this._focusPath = path

    this._updateDom()
  }

  /**
   * Visible tree buttons in DOM order — the arrow-key cursor space for
   * the treeview pattern (only rendered rows exist, so collapsed
   * subtrees are naturally skipped).
   */
  private _treeButtons(): HTMLButtonElement[] {
    return this.$$(DOCS_SELECTORS.TREE_ITEM) as HTMLButtonElement[]
  }

  /**
   * ARIA treeview keys on the nav: ↑/↓ move between visible rows, → opens
   * a closed dir (or descends into an open one), ← closes an open dir (or
   * focuses the parent). The rows are anchors now — Enter activates
   * natively, Space is routed to a click since anchors don't activate on
   * Space like buttons do.
   */
  onTreeKey(e: KeyboardEvent): void {
    const btn = e.target as HTMLButtonElement

    const items = this._treeButtons()

    const idx = items.indexOf(btn)

    if (idx < 0) return

    // Rendered rows always carry data-path (see render.ts tree builder) —
    // the cast documents that contract instead of a dead `|| ''` fallback.
    const path = btn.getAttribute(DATA_ATTRS.DATA_PATH) as string

    if (e.key === KEYS.SPACE) {
      // Anchors don't fire on Space — reroute to the click handler so
      // keyboard activation matches the old button semantics.
      e.preventDefault()

      btn.click()
    } else if (e.key === KEYS.ARROW_DOWN) {
      e.preventDefault()

      items[idx + 1]?.focus()
    } else if (e.key === KEYS.ARROW_UP) {
      e.preventDefault()

      items[idx - 1]?.focus()
    } else if (e.key === KEYS.ARROW_RIGHT) {
      e.preventDefault()

      const expanded = btn.getAttribute(ARIA_ATTRS.ARIA_EXPANDED) === 'true'

      if (btn.hasAttribute(ARIA_ATTRS.ARIA_EXPANDED) && !expanded) {
        this.toggleDir(path)
      } else {
        items[idx + 1]?.focus()
      }
    } else if (e.key === KEYS.ARROW_LEFT) {
      e.preventDefault()

      const expanded = btn.getAttribute(ARIA_ATTRS.ARIA_EXPANDED) === 'true'

      if (expanded) {
        this.toggleDir(path)
      } else {
        // Focus the parent dir row — the nearest previous button whose
        // path is the current one's parent segment; section members climb
        // to their group row (their real path parent is not a rendered
        // row, e.g. 'src' → 'group/source', 'docs/sassdoc' → 'group/docs').
        const parentPath = path.split(CHAR_STRINGS.SLASH).slice(0, -1).join(CHAR_STRINGS.SLASH)

        const parent =
          items.find((b) => (b.getAttribute(DATA_ATTRS.DATA_PATH) as string) === parentPath) ||
          items.find(
            (b) => (b.getAttribute(DATA_ATTRS.DATA_PATH) as string) === docsGroupParent(path)
          )

        parent?.focus()
      }
    }
  }

  /**
   * Arrow-key roving on the folder grid — ←/→/↑/↓ step between cards in
   * DOM order (the grid's column count is layout-derived, so linear
   * traversal is the robust choice on every breakpoint).
   */
  onGridKey(e: KeyboardEvent): void {
    const btn = e.target as HTMLButtonElement

    if (!btn.classList.contains(DOCS_CLASSES.DOCS_CARD)) return

    const cards = this.$$(DOCS_SELECTORS.CARD) as HTMLButtonElement[]

    // The event target carries the card class, so it's necessarily inside
    // this shadow root — indexOf can't fail on the same selector set.
    const idx = cards.indexOf(btn)

    const delta =
      e.key === KEYS.ARROW_RIGHT || e.key === KEYS.ARROW_DOWN
        ? 1
        : e.key === KEYS.ARROW_LEFT || e.key === KEYS.ARROW_UP
          ? -1
          : 0

    if (!delta) return

    e.preventDefault()

    cards[idx + delta]?.focus()
  }

  /**
   * Host-level keys — Escape backs out of the open file (or closes the
   * mobile nav panel) without leaving the portal.
   */
  onViewKey(e: KeyboardEvent): void {
    if (e.key !== KEYS.ESCAPE) return

    if (this._mapZoomed) {
      this.closeMapZoom()
    } else if (this.filePayload) {
      this.closeFile()
    } else if (this.navOpen) {
      this.navOpen = false

      this._updateDom()
    }
  }

  /**
   * Editable-breadcrumb commit — Enter navigates to the typed path,
   * Escape restores the input to the live path.
   */
  onCrumbKey(e: KeyboardEvent): void {
    const input = e.target as HTMLInputElement

    if (e.key === KEYS.ENTER) {
      this.navigateDocs(input.value.trim().replace(/^\//u, CHAR_STRINGS.EMPTY))

      input.blur()
    } else if (e.key === KEYS.ESCAPE) {
      // Restore the rendered form — the input always shows '/<path>' so
      // the portal root reads as '/' (this level IS the root).
      input.value = `${CHAR_STRINGS.SLASH}${this.docsPath}`

      input.blur()
    }
  }

  /**
   * Same-tag navigation (file → sibling): resolves the new path without
   * tearing down GL/observability state.
   */
  onRouteParamChange(to?: RouteDescriptor): void {
    this._applyPath(to?.params?.docsPath || CHAR_STRINGS.EMPTY)
  }

  /** Lifecycle: store sub + path resolution + guards. */
  override onMounted(): void {
    this.subscribe(store)

    this._updateLoader(DOCS_STRINGS.LOADER_MSG_MANIFEST, DOCS_LOADER_PCT.MANIFEST)

    this._applyPath(router.currentRoute?.params?.docsPath || CHAR_STRINGS.EMPTY)

    this._guardDispose = attachCopyGuard(
      this.shadowRoot as ShadowRoot,
      () => this.isProtectedView(),
      () => this.docsPath,
      this._toastText
    )

    window.addEventListener(PRINT_EVENTS.PREPARE, this._onPrintPrepare)
  }

  /**
   * Print-prepare answer — the print adapter fires `printprepare` before
   * its media walk so generated DOM reaches the readable mirror: the
   * payload box's rendered form (mermaid SVG diagrams, istanbul tables)
   * replaces the article's static copy. Cloned canvases are dead buffers
   * and get stripped — the live canvases inject their own captured
   * stills during the walk.
   */
  private _onPrintPrepare = (): void => {
    const article = document.querySelector(`${HTML_TAGS.ARTICLE}.${READER_CLASSES.CONTENT}`)

    if (!article) return

    // Protected source views never print — the exfiltration guard blanks
    // the live viewer via @media print, and the emitted mirror carries the
    // same source payload, so it can't reach the print pass either. Instead
    // of a literal blank sheet the mirror carries the localized guard
    // notice — the press output still reads as a deliberate result. The
    // check reads the node (not the payload) so a print fired before the
    // fetch lands is still guarded.
    if (this.node && isSourceRoot(fileIdRoot(this.node.id || CHAR_STRINGS.EMPTY))) {
      const note = document.createElement(HTML_TAGS.P)

      note.textContent = this._toastText()

      article.replaceChildren(note)

      return
    }

    const box = this.$(DOCS_SELECTORS.CONTENT)

    if (!box?.childElementCount) return

    const clone = box.cloneNode(true) as HTMLElement

    clone.querySelectorAll(HTML_TAGS.CANVAS).forEach((c) => c.remove())

    article.replaceChildren(...Array.from(clone.childNodes))
  }

  /** Lifecycle: (re)mounts the GL strip, scene and viewer content. */
  override onUpdated(): void {
    const glCanvas = this.$(`#${DOCS_IDS.GL}`) as HTMLCanvasElement | null

    if (glCanvas && glCanvas !== this._glCanvas) {
      this._glHandle?.destroy()

      this._glCanvas = glCanvas
      this._glHandle = mountDocsGlStrip(glCanvas, this)

      if (!this._glHandle) {
        this.classList.add(DOCS_CLASSES.DOCS_GL_FALLBACK)
      }
    }

    // The scene canvas is PERSISTENT — created once, re-seated into
    // whichever stage this render produced (the right-hand map column,
    // or the zoom dialog while _mapZoomed). Re-parenting keeps the WebGL
    // context and graph alive across every _updateDom — previously each
    // render rebuilt the canvas and remounted the whole scene, so a
    // tree-toggle paid a full GPU graph rebuild.
    const sceneCanvas = this._sceneEl()

    const stage = this.$(DOCS_SELECTORS.SCENE_STAGE)

    if (stage && sceneCanvas.parentNode !== stage) stage.appendChild(sceneCanvas)

    // Mount exactly once (or again after a context loss cleared the
    // handle) — the scene-off class marks a dead mount so failed hosts
    // don't retry the GPU on every render.
    if (!this._sceneHandle && !sceneCanvas.classList.contains(DOCS_CLASSES.DOCS_SCENE_OFF)) {
      this._mountScene(sceneCanvas)

      // The mount attempt just finished either way (live scene or
      // scene-off fallback) — advance the loader to the scene stage.
      if (!this._docsReady) {
        this._updateLoader(DOCS_STRINGS.LOADER_MSG_SCENE, DOCS_LOADER_PCT.SCENE)
      }
    }

    // Keep the map's active-location marker in sync — both on fresh
    // mounts and on same-canvas navigations (the scene persists). The
    // resolved node path carries the root-bucket prefix the scene's
    // target table keys on; bare URLs ('architecture/x.md') resolve to
    // 'docs/architecture/x.md' before the lookup, and unresolvable
    // paths fall back to the portal root. Bucket roots whose children
    // were promoted into a section (the docs bucket → Documentation)
    // aren't scene nodes themselves — their highlight lands on the
    // owning section group.
    this._sceneHandle?.setActive(this._scenePath(this.node?.path || CHAR_STRINGS.EMPTY))

    this._syncMapCloseBtn()

    this._syncScenePaused()

    // Arrow-key expand/collapse re-creates the DOM — put focus back on
    // the row that was being driven so ↑/↓ continue from there.
    if (this._focusPath) {
      const focusPath = this._focusPath

      this._focusPath = null

      const target = this._treeButtons().find(
        (b) => (b.getAttribute(DATA_ATTRS.DATA_PATH) as string) === focusPath
      )

      target?.focus()
    }

    // Roving-tabstop guarantee — first render (null _treeTabPath) and a
    // collapse that hid the stop both leave every row at tabindex="-1";
    // promote the first rendered row so the tree always keeps one Tab
    // entry instead of becoming unreachable by keyboard.
    const treeItems = this._treeButtons()

    if (treeItems.length && !treeItems.some((b) => b.tabIndex === 0)) {
      this._treeTabPath = treeItems[0].getAttribute(DATA_ATTRS.DATA_PATH) as string

      treeItems[0].setAttribute(ARIA_ATTRS.TABINDEX, ATTR_VALUES.TABINDEX_ZERO)
    }

    // Map-zoom focus hand-off — the expand-modal contract: the dialog's
    // close button takes focus on open; the column's zoom trigger takes
    // it back on close.
    if (this._mapFocus) {
      const mapFocus = this._mapFocus

      this._mapFocus = null

      const focusEl =
        mapFocus === 'open'
          ? (this.$(`.${PREF_CLASSES.PREF_CLOSE_BTN}`) as HTMLElement | null)
          : (this.$(`.${DOCS_CLASSES.DOCS_MAP_ZOOM}`) as HTMLElement | null)

      focusEl?.focus()
    }

    this._renderFilePayload()

    this._syncLoader()
  }

  /**
   * Mounts/refreshes the zoom dialog's animated close button on its live
   * canvas — same mount contract as the preferences/expand-modal close
   * (the canvas is re-created with each render that produces the dialog,
   * so a stale handle is destroyed and remounted). No dialog → the
   * widget is destroyed outright so it holds no GL context slot.
   */
  private _syncMapCloseBtn(): void {
    const canvas = this.$(`.${PREF_CLASSES.PREF_CLOSE_CANVAS}`) as HTMLCanvasElement | null

    if (!canvas) {
      this._mapCloseBtn?.destroy()

      this._mapCloseBtn = null

      return
    }

    if (this._mapCloseBtn && this._mapCloseBtn.canvas !== canvas) {
      this._mapCloseBtn.destroy()

      this._mapCloseBtn = null
    }

    if (!this._mapCloseBtn) {
      applyAnimationDesc(canvas, ANIMATION_IDS.CLOSE_BUTTON)

      this._mapCloseBtn = new CloseButtonWebGL(canvas, () => this.closeMapZoom())
    }
  }

  /** Mirrors a boot stage into the loader overlay (delegates to loader.ts). */
  _updateLoader(msg: string, pct: number): void {
    updateDocsLoader(this, msg, pct)
  }

  /** Fades + removes the loader overlay (delegates to loader.ts). */
  _dismissLoader(): void {
    dismissDocsLoader(this)
  }

  /**
   * Advances or dismisses the boot loader based on the just-rendered
   * state: a file fetch in flight reports the file stage and waits;
   * anything else means the portal is usable — mark ready, report the
   * final stage, and fade the overlay out. A failed payload fetch (null)
   * still counts as settled so the loader can never strand the page.
   */
  private _syncLoader(): void {
    if (this._docsReady) return

    if (this.fileLoading) {
      this._updateLoader(DOCS_STRINGS.LOADER_MSG_FILE, DOCS_LOADER_PCT.FILE)

      return
    }

    this._updateLoader(DOCS_STRINGS.LOADER_MSG_READY, DOCS_LOADER_PCT.READY)

    this._docsReady = true

    this._dismissLoader()
  }

  /**
   * The persistent scene canvas — created once with its id/class/label
   * and the `webglcontextrestored` recovery listener, then re-seated by
   * onUpdated into whichever stage this render produced. Re-parenting a
   * canvas preserves its WebGL context, so the scene survives renders,
   * column↔dialog moves and tree toggles without a remount.
   * @returns The shared scene canvas element.
   */
  private _sceneEl(): HTMLCanvasElement {
    if (!this._sceneCanvas) {
      const canvas = document.createElement(HTML_TAGS.CANVAS)

      canvas.id = DOCS_IDS.SCENE
      canvas.className = DOCS_CLASSES.DOCS_SCENE
      canvas.setAttribute(ARIA_ATTRS.ARIA_LABEL, DOCS_STRINGS.TREE_LABEL)

      // `webglcontextrestored` is the recovery signal — the browser hands
      // the canvas a fresh context, so a full remount rebuilds the graph.
      canvas.addEventListener(GL_EVENTS.WEBGL_CONTEXT_RESTORED, this._onSceneRestored)

      this._sceneCanvas = canvas
    }

    return this._sceneCanvas
  }

  /**
   * Maps a manifest path to the path the scene knows — section groups
   * are scene nodes ('group/…'), manifest members are scene nodes, but
   * a bucket root whose children were promoted into a section (the
   * docs bucket → Documentation) exists only in the URL space, so its
   * highlight maps to the owning group node.
   * @param path Manifest-relative docs path.
   * @returns The scene node's path for the highlight/focus lookup.
   */
  private _scenePath(path: string): string {
    if (!path) return path

    const groups = docsGroups()
    const inScene = groups.some(
      (g) =>
        g.path === path ||
        g.children?.some((c) => c.path === path) ||
        !(getDocsManifest().roots as Array<{ root: string }>).some((r) => r.root === path)
    )

    if (inScene) return path

    const owner = groups.find((g) =>
      g.children?.some((c) => c.path.startsWith(`${path}${CHAR_STRINGS.SLASH}`))
    )

    return owner?.path ?? path
  }

  /**
   * Mounts/remounts the 3D scene on the given canvas. `onLost` marks the
   * canvas with the scene-off class and clears the handle so a later
   * `webglcontextrestored` can rebuild it — the portal stays usable the
   * whole time.
   */
  /**
   * Scene ready/lost teardown for the map-stage veil — flag off so
   * subsequent renders skip it, then the live node fades + removes
   * (same opacity→remove contract as the boot loader's dismissal).
   */
  private _dismissSceneLoading(): void {
    this._sceneLoading = false

    const veil = this.$<HTMLElement>(DOCS_SELECTORS.MAP_LOADING)

    if (!veil) return

    veil.style.opacity = CHAR_STRINGS.ZERO

    setTimeout(() => veil.remove(), ANIMATION_DURATIONS.LOADER_FADE_MS)
  }

  private _mountScene(canvas: HTMLCanvasElement): void {
    this._sceneHandle?.destroy()

    this._sceneCanvas = canvas

    // A mid-life remount (context restore) lands between renders —
    // re-arm the flag and re-render so the stage reproduces the veil.
    if (!this._sceneLoading) {
      this._sceneLoading = true

      this._updateDom()
    }

    this._sceneHandle = mountArchScene(
      canvas,
      // The scene's top ring IS the portal's four sections — the map
      // reads Source Code / Documentation / Architecture / Reports as
      // separated clusters instead of a flat 19-bucket fan.
      docsGroups().map((g) => ({ root: g.path, label: g.name, children: g.children })),
      (path) => {
        // Section-group paths aren't routable — picking one does
        // nothing beyond the highlight pass (mirrors pickNode).
        if (path.startsWith(DOCS_STRINGS.GROUP_PATH_PREFIX)) return

        this.navigateDocs(path)
      },
      () => {
        canvas.classList.add(DOCS_CLASSES.DOCS_SCENE_OFF)

        this._sceneHandle = null

        this._dismissSceneLoading()
      },
      () => this._dismissSceneLoading()
    )

    // No WebGL2 (or a dead context) → hide the canvas rather than a
    // blank box; the grid/tree/crumb navigation carries the portal.
    canvas.classList.toggle(DOCS_CLASSES.DOCS_SCENE_OFF, !this._sceneHandle)

    // Synchronous mount failure never reaches onLost — drop the veil.
    if (!this._sceneHandle) this._dismissSceneLoading()

    // Start watching the map-column breakpoint on the first mount —
    // one listener for the element's lifetime.
    if (!this._mapMq && typeof matchMedia === TYPE_STRINGS.FUNCTION) {
      this._mapMq = matchMedia(MEDIA_QUERIES.MIN_WIDTH_1025)
      this._mapMq.addEventListener(FORM_EVENTS.CHANGE, this._onMapMq)
    }
  }

  /**
   * Pause-state sync — the scene loop halts while the map column is
   * display:none (≤1024) AND the zoom dialog is closed; at wider widths,
   * or while the glass dialog is open, the loop runs. Called from
   * onUpdated, the mq change listener, and toggleMapZoom.
   */
  private _syncScenePaused(): void {
    const columnVisible = this._mapMq ? this._mapMq.matches : true

    this._sceneHandle?.setPaused(!columnVisible && !this._mapZoomed)
  }

  /** `webglcontextrestored` handler — rebuilds the scene on the fresh context. */
  private _onSceneRestored = (e: Event): void => {
    // currentTarget is the canvas that owns the listener — the listener is
    // detached in onDestroy, so it can only ever fire on a live canvas.
    const canvas = e.currentTarget as HTMLCanvasElement

    canvas.classList.remove(DOCS_CLASSES.DOCS_SCENE_OFF)

    this._mountScene(canvas)
  }

  /** Lifecycle: disposes guard + GL surfaces. */
  override onDestroy(): void {
    this._guardDispose?.()

    this._guardDispose = null

    this._covNavDispose?.()

    this._covNavDispose = null

    this._sceneCanvas?.removeEventListener(GL_EVENTS.WEBGL_CONTEXT_RESTORED, this._onSceneRestored)

    this._mapMq?.removeEventListener(FORM_EVENTS.CHANGE, this._onMapMq)

    this._mapMq = null

    window.removeEventListener(PRINT_EVENTS.PREPARE, this._onPrintPrepare)

    this._glHandle?.destroy()

    this._glHandle = null
    this._glCanvas = null

    this._sceneHandle?.destroy()

    this._sceneHandle = null
    this._sceneCanvas = null

    this._mapCloseBtn?.destroy()

    this._mapCloseBtn = null

    // The docs JSON-LD graph is page-scoped, but the nav pipeline emits
    // the next route's graph BEFORE this element disconnects — clearing
    // here would wipe the incoming route's head data, so the node is
    // simply overwritten by syncDocumentHead on every navigation.
  }

  /**
   * Applies a docsPath: resolves the manifest node, auto-expands the
   * ancestor dirs in the treeview, syncs the page title + JSON-LD graph
   * (BreadcrumbList + TechArticle/CollectionPage) so every /docs/* route
   * is crawlable, and kicks the lazy file fetch.
   */
  private _applyPath(docsPath: string): void {
    this.docsPath = docsPath
    this.node = resolveDocsPath(docsPath)

    const pageName = this.node?.name || DOCS_STRINGS.TITLE

    document.title = `${BASE_TITLE} ${CHAR_STRINGS.PIPE_SEP} ${pageName}`

    updateJsonLd(generateDocsSchema(docsPath, this.node))

    // Auto-expand ancestor dirs so the tree lands open on the current path.
    const segments = docsPath.split(CHAR_STRINGS.SLASH).filter(Boolean)

    segments.slice(0, -1).forEach((_seg, i) => {
      this._openDirs.add(segments.slice(0, i + 1).join(CHAR_STRINGS.SLASH))
    })

    // Section rows are not path ancestors — a routed member ('src/x',
    // 'docs/sassdoc') still needs its group row open to stay visible.
    const groupPath = docsGroupParent(docsPath)

    if (groupPath) this._openDirs.add(groupPath)

    // Folders carrying an index.html auto-open it (e.g. the sassdoc
    // report) — except under source-module roots, which stay browsable
    // source trees. A dir node only resolves from a non-empty docsPath,
    // so segments[0] is necessarily set here — the cast documents that
    // invariant instead of a dead `|| ''` fallback.
    if (this.node?.type === 'dir' && !isSourceRoot(segments[0] as string)) {
      // scan.mjs only emits dirs with children — the cast documents that
      // manifest invariant (an empty dir would never reach this branch).
      const index = (this.node.children as DocsNode[]).find(
        (c) => c.type === 'file' && c.name === DOCS_STRINGS.INDEX_FILE
      )

      if (index) {
        this.navigateDocs(`${docsPath}${CHAR_STRINGS.SLASH}${index.name}`)

        return
      }
    }

    if (this.node?.type === 'file' && this.node.id) {
      this._loadFile(this.node.id)
    } else {
      this.filePayload = null
      this.fileLoading = false
    }

    this._updateDom()
  }

  /** Lazy file payload fetch → state → innerHTML paint in onUpdated. */
  private _loadFile(id: string): void {
    this.fileLoading = true
    this.filePayload = null

    this._updateDom()

    // fetchDocsFile resolves null on failure — the payload state is the
    // only outcome, so there is no rejection path to handle here.
    void fetchDocsFile(id).then((payload) => {
      this.fileLoading = false
      this.filePayload = payload

      if (!payload) devWarn('docs payload fetch failed for', id)

      this._updateDom()
    })
  }

  /**
   * Paints the open payload — media data-URL for images, rendered HTML
   * for everything else (markdown, JSON trees, sanitized html reports,
   * code blocks). innerHTML (not the JSX sanitizer) because payloads are
   * build-time generated markup that needs <pre>/<table>/<style> intact.
   */
  private _renderFilePayload(): void {
    const box = this.$(DOCS_SELECTORS.CONTENT)

    if (!box || !this.filePayload) return

    const payload = this.filePayload

    if (payload.format === 'media') {
      // Oversized binaries carry media:null — show the GitHub pointer.
      const img = document.createElement(HTML_TAGS.IMG)

      if (payload.media) {
        img.src = payload.media
        img.alt = payload.name

        box.replaceChildren(img)
      } else {
        box.textContent = DOCS_STRINGS.MEDIA_UNAVAILABLE
      }

      return
    }

    if (payload.html !== null && payload.html !== undefined) {
      box.innerHTML = payload.html

      // Lazy diagram + report-keyboard wiring — mermaid blocks render
      // into themed SVGs; istanbul reports get their n/j/b/p/k uncovered
      // -block navigation back (the sanitizer strips their helper script).
      void renderMermaidBlocks(box as HTMLElement)

      this._covNavDispose?.()

      this._covNavDispose = attachCoverageNav(box as HTMLElement)

      // The content box is recreated by every _updateDom (replaceChildren),
      // so no re-wire guard is needed — the listener always lands fresh.
      box.addEventListener(MOUSE_EVENTS.CLICK, this._onContentLink)
    }
  }

  /**
   * Intercepts anchor clicks inside painted payload HTML — relative links
   * inside reports (istanbul `../index.html`, sibling file pages) resolve
   * against the current /docs route and stay inside the SPA; hash and
   * external links pass through untouched.
   */
  private _onContentLink = (e: Event): void => {
    const anchor = (e.target as HTMLElement).closest?.(DOCS_SELECTORS.CONTENT_LINK)

    if (!anchor) return

    // CONTENT_LINK selects `a[href]` only — the matched anchor always
    // carries the attribute, so the cast documents the selector contract.
    const href = anchor.getAttribute('href') as string

    if (!href || href.startsWith(CHAR_STRINGS.HASH)) return

    const url = new URL(href, window.location.href)

    const docsPrefix = `${ROUTE_PATHS.DOCS}${CHAR_STRINGS.SLASH}`

    if (!url.pathname.startsWith(docsPrefix)) return

    // Modified/middle clicks keep native anchor semantics (new tab).
    if (!isPlainClick(e)) return

    e.preventDefault()

    this.navigateDocs(decodeURIComponent(url.pathname.slice(docsPrefix.length)))
  }

  /** JSX template — lives in render.tsx. */
  override render() {
    return renderDocs(this)
  }
}

if (!customElements.get(VIEW_TAGS.VIEW_DOCS)) {
  customElements.define(VIEW_TAGS.VIEW_DOCS, ViewDocs)
}
