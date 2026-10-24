/**
 * @file docs-tails-docs-gl-strip.test.js
 * @description Split from docs-tails.test.js — covers the "docs GL strip" describe.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { mountDocsGlStrip } from '@docs/gl-strip.js'
import { createMockGL } from '@tests/fixtures/mock-webgl.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { GL_EVENTS } from '@core/tokens/events/dom.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

// ─── gl-strip.ts ──────────────────────────────────────────────────────────────
describe('docs GL strip', () => {
  let origGetContext
  let mockGL

  beforeEach(() => {
    mockGL = createMockGL()

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    origGetContext = proto.getContext

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      return null
    }
  })

  afterEach(() => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = origGetContext
  })

  test('mounts, draws frames, and destroys cleanly', async () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)
    const host = document.createElement('div')

    document.body.appendChild(canvas)
    document.body.appendChild(host)

    const handle = mountDocsGlStrip(canvas, host)

    expect(handle).not.toBe(null)

    await flush()

    handle.destroy()

    canvas.remove()
    host.remove()
  })

  test('returns null when the context probe fails', () => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => null

    const canvas = document.createElement(HTML_TAGS.CANVAS)
    const host = document.createElement('div')

    expect(mountDocsGlStrip(canvas, host)).toBe(null)

    proto.getContext = origGetContext
    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      return null
    }
  })

  test('returns null when shader compilation fails', () => {
    const failGl = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === 'string' && prop === prop.toUpperCase()) return 1

          return () => {
            if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return false
            if (prop === 'getShaderInfoLog') return 'fail'
            if (prop === 'getExtension') return { loseContext: () => {} }
            if (prop === 'createShader' || prop === 'createProgram') return {}

            return undefined
          }
        },
        set: () => true,
      }
    )

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => failGl

    expect(
      mountDocsGlStrip(document.createElement(HTML_TAGS.CANVAS), document.createElement('div'))
    ).toBe(null)

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      return null
    }
  })

  test('disables blending before the first draw — fullscreen overwrite must never accumulate alpha into an opaque veil', async () => {
    const calls = []

    const recordingGL = new Proxy(mockGL, {
      get(target, prop) {
        const value = target[prop]

        if (
          prop === 'enable' ||
          prop === 'disable' ||
          prop === 'blendFunc' ||
          prop === 'drawArrays'
        )
          return (...args) => {
            calls.push([prop, ...args])

            return value(...args)
          }

        return value
      },
    })

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => recordingGL

    const canvas = document.createElement(HTML_TAGS.CANVAS)
    const host = document.createElement('div')

    document.body.appendChild(canvas)
    document.body.appendChild(host)

    const handle = mountDocsGlStrip(canvas, host)

    expect(handle).not.toBe(null)

    await flush()

    handle.destroy()

    canvas.remove()
    host.remove()

    const blendDisable = calls.findIndex(
      ([name, arg]) => name === 'disable' && arg === mockGL.BLEND
    )

    const firstDraw = calls.findIndex(([name]) => name === 'drawArrays')

    const enablesAfterDisable = calls
      .slice(blendDisable + 1)
      .filter(([name, arg]) => name === 'enable' && arg === mockGL.BLEND)

    // createQuadProgram enables BLEND for shared callers; the strip must
    // turn it back off — blending over a never-cleared fullscreen quad
    // converges alpha to 1 and paints a solid u_col layer (white in
    // dark mode) over the whole docs page.
    expect(blendDisable).toBeGreaterThan(-1)
    expect(firstDraw).toBeGreaterThan(blendDisable)
    expect(enablesAfterDisable).toHaveLength(0)
  })

  test('context loss flags the host with the fallback class', async () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)
    const host = document.createElement('div')

    document.body.appendChild(canvas)
    document.body.appendChild(host)

    const handle = mountDocsGlStrip(canvas, host)

    canvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_LOST))

    await flush()

    expect(host.classList.contains(DOCS_CLASSES.DOCS_GL_FALLBACK)).toBe(true)

    handle.destroy()

    canvas.remove()
    host.remove()
  })

  test('theme observer re-samples inks on mutation and disconnects on destroy', async () => {
    const origMO = globalThis.MutationObserver
    const origGCS = globalThis.getComputedStyle

    let moCb = null
    let disconnects = 0

    globalThis.MutationObserver = class {
      constructor(cb) {
        moCb = cb
      }

      observe() {}
      disconnect() {
        disconnects++
      }
    }

    let ink = 'rgb(10, 20, 30)'
    let bgc = 'rgb(40, 50, 60)'

    globalThis.getComputedStyle = (el) =>
      el === document.body ? { backgroundColor: bgc } : { color: ink }

    const u3 = []

    const recordingGL = new Proxy(mockGL, {
      get(target, prop) {
        const value = target[prop]

        if (prop === 'uniform3f')
          return (...args) => {
            u3.push(args.slice(1))

            return value(...args)
          }

        return value
      },
    })

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => recordingGL

    try {
      const canvas = document.createElement(HTML_TAGS.CANVAS)
      const host = document.createElement('div')

      document.body.appendChild(canvas)
      document.body.appendChild(host)

      const handle = mountDocsGlStrip(canvas, host)

      expect(handle).not.toBe(null)

      await flush()

      // Mount-time sample — the first frames carry the stubbed inks.
      expect(u3).toContainEqual([10 / 255, 20 / 255, 30 / 255])
      expect(u3).toContainEqual([40 / 255, 50 / 255, 60 / 255])

      // A class flip on <html> re-reads both computed styles — the new
      // ink lands in the next frame's u_col/u_bg uploads.
      ink = 'rgb(200, 100, 50)'
      bgc = 'rgb(5, 15, 25)'

      moCb()

      await flush()

      expect(u3).toContainEqual([200 / 255, 100 / 255, 50 / 255])
      expect(u3).toContainEqual([5 / 255, 15 / 255, 25 / 255])

      // Unparseable styles keep the previous sample — the `|| color`
      // and `|| bg` fallback arms inside the observer callback.
      ink = 'not-a-color'
      bgc = 'transparent'

      moCb()

      await flush()

      expect(u3[u3.length - 2]).toEqual([200 / 255, 100 / 255, 50 / 255])
      expect(u3[u3.length - 1]).toEqual([5 / 255, 15 / 255, 25 / 255])

      handle.destroy()

      expect(disconnects).toBe(1)

      canvas.remove()
      host.remove()
    } finally {
      proto.getContext = origGetContext
      globalThis.MutationObserver = origMO
      globalThis.getComputedStyle = origGCS
    }
  })

  test('mounts without MutationObserver — the observer optional-chains collapse to null', async () => {
    const origMO = globalThis.MutationObserver

    delete globalThis.MutationObserver

    try {
      const canvas = document.createElement(HTML_TAGS.CANVAS)
      const host = document.createElement('div')

      document.body.appendChild(canvas)
      document.body.appendChild(host)

      const handle = mountDocsGlStrip(canvas, host)

      expect(handle).not.toBe(null)

      await flush()

      // Destroy takes the `themeObserver?.disconnect()` short-circuit.
      handle.destroy()

      canvas.remove()
      host.remove()
    } finally {
      globalThis.MutationObserver = origMO
    }
  })

  test('unparseable computed inks fall back to black uniforms', async () => {
    const origGCS = globalThis.getComputedStyle

    globalThis.getComputedStyle = () => ({ color: 'transparent', backgroundColor: '' })

    const u3 = []

    const recordingGL = new Proxy(mockGL, {
      get(target, prop) {
        const value = target[prop]

        if (prop === 'uniform3f')
          return (...args) => {
            u3.push(args.slice(1))

            return value(...args)
          }

        return value
      },
    })

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => recordingGL

    try {
      const canvas = document.createElement(HTML_TAGS.CANVAS)
      const host = document.createElement('div')

      document.body.appendChild(canvas)
      document.body.appendChild(host)

      const handle = mountDocsGlStrip(canvas, host)

      expect(handle).not.toBe(null)

      await flush()

      // Both `|| [0, 0, 0]` mount-time fallbacks — u_col and u_bg read 0.
      expect(u3).toContainEqual([0, 0, 0])

      handle.destroy()

      canvas.remove()
      host.remove()
    } finally {
      proto.getContext = origGetContext
      globalThis.getComputedStyle = origGCS
    }
  })
})
