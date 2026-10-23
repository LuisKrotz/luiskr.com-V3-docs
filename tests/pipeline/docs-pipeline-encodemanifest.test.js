/**
 * @file docs-pipeline-encodemanifest.test.js
 * @description Covers shared/build/docs/encode.mjs — the compaction pass
 * that turns scanManifest's verbose tree into the interned tuple wire
 * form shipped as `virtual:docs-manifest`.
 */
import { describe, test, expect } from '@jest/globals'
import { encodeManifest } from '@build/docs/encode.mjs'

/** Minimal two-root fixture — repeated names exercise the string interner. */
const FIXTURE = {
  generated: '2024-06-01T12:00:00.000Z',
  roots: [
    {
      root: 'docs',
      label: 'Documentation',
      kind: 'docs',
      children: [
        {
          type: 'dir',
          name: 'guides',
          path: 'docs/guides',
          children: [
            {
              type: 'file',
              name: 'index.html',
              path: 'docs/guides/index.html',
              id: 'docs:guides/index.html',
              format: 'html',
              size: 100,
              mtime: '2024-06-01T12:00:00.000Z',
              embedded: true,
            },
          ],
        },
        {
          type: 'file',
          name: 'index.html',
          path: 'docs/index.html',
          id: 'docs:index.html',
          format: 'html',
          size: 50,
          mtime: '2024-06-01T12:00:00.000Z',
          embedded: true,
        },
      ],
    },
    {
      root: 'src',
      label: 'Source',
      kind: 'source',
      children: [
        {
          type: 'file',
          name: 'index.html',
          path: 'src/index.html',
          id: 'src:index.html',
          format: 'code',
          size: 30,
          mtime: '2024-06-01T12:00:00.000Z',
          embedded: true,
        },
      ],
    },
  ],
}

describe('encodeManifest', () => {
  test('interns every distinct string once in the strings table', () => {
    const wire = encodeManifest(FIXTURE)

    // 'index.html' appears on three nodes but interning keeps one entry.
    expect(wire.strings.filter((s) => s === 'index.html').length).toBe(1)
    expect(new Set(wire.strings).size).toBe(wire.strings.length)
    expect(wire.generated).toBe(FIXTURE.generated)
  })

  test('schema keys and derivable fields never cross the wire', () => {
    const raw = JSON.stringify(encodeManifest(FIXTURE))

    // Keys that used to repeat per node are gone entirely; path/id are
    // derived at hydration so no 'docs/' or 'docs:' prefixes serialize.
    for (const dead of ['"type"', '"name"', '"path"', '"id"', '"format"', '"size"', '"embedded"']) {
      expect(raw.includes(dead)).toBe(false)
    }

    expect(raw.includes('docs/')).toBe(false)
    expect(raw.includes('docs:')).toBe(false)
  })

  test('nodes encode as [nameIdx, mtimeMs] files and [nameIdx, children] dirs', () => {
    const wire = encodeManifest(FIXTURE)
    const [rootIdx, labelIdx, kindIdx, children] = wire.roots[0]

    expect(wire.strings[rootIdx]).toBe('docs')
    expect(wire.strings[labelIdx]).toBe('Documentation')
    expect(wire.strings[kindIdx]).toBe('docs')

    const [dirName, grandchildren] = children[0]

    expect(wire.strings[dirName]).toBe('guides')
    expect(Array.isArray(grandchildren)).toBe(true)

    const [fileName, mtimeMs] = children[1]

    expect(wire.strings[fileName]).toBe('index.html')
    expect(mtimeMs).toBe(Date.parse('2024-06-01T12:00:00.000Z'))
  })

  test('case-merged nodes carry their real rel as a trailing override', () => {
    const merged = {
      generated: FIXTURE.generated,
      roots: [
        {
          root: 'src',
          label: 'Source',
          kind: 'source',
          children: [
            {
              type: 'dir',
              name: 'app',
              path: 'src/app',
              children: [
                {
                  type: 'file',
                  name: 'x.ts',
                  path: 'src/App/x.ts',
                  id: 'src:App/x.ts',
                  format: 'code',
                  size: 1,
                  mtime: '2024-06-01T12:00:00.000Z',
                  embedded: true,
                },
                {
                  type: 'dir',
                  name: 'sub',
                  path: 'src/App/sub',
                  children: [
                    {
                      type: 'file',
                      name: 'y.ts',
                      path: 'src/App/sub/y.ts',
                      id: 'src:App/sub/y.ts',
                      format: 'code',
                      size: 1,
                      mtime: '2024-06-01T12:00:00.000Z',
                      embedded: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const wire = encodeManifest(merged)
    const [, , , children] = wire.roots[0]
    const [appIdx, appKids] = children[0]

    // 'app' itself derives positionally — plain [nameIdx, children].
    expect(children[0].length).toBe(2)
    expect(wire.strings[appIdx]).toBe('app')

    // The file and dir inside carry their real 'App/…' rel as element 2.
    expect(wire.strings[appKids[0][2]]).toBe('App/x.ts')
    expect(wire.strings[appKids[1][2]]).toBe('App/sub')

    // The grandchild derives from its parent's real rel — no override.
    expect(appKids[1][1][0].length).toBe(2)
  })
})
