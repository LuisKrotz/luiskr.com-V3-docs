/**
 * @file jest.config.mjs — docs-portal module test config.
 * Covers experiments/docs/** — the viewer, manifest, arch scene, coverage
 * navigation, and mermaid pipeline. Exempt from Lighthouse by contract.
 *
 * Adds one mock on top of the shared preset: the wasm diagram engine
 * can't instantiate under jest (no real .wasm URL to fetch), so docs
 * suites route `@core/utils/wasm/wasm-diagram.js` to the recording stub
 * — the mapper entry precedes the preset's `@core/(.*)` passthrough so
 * the specific path wins. Core's own wasm-diagram tails keep the real
 * module because this mapper is scoped to this config only.
 */
import path from 'node:path'
import { makeConfig, moduleNameMapper, TESTS_DIR } from '../../shared/tests/jest.preset.mjs'

export default {
  ...makeConfig({ name: 'docs-portal', dir: 'experiments/docs' }),
  moduleNameMapper: {
    '^@core/utils/wasm/wasm-diagram\\.js$': path.join(TESTS_DIR, '__mocks__/wasm-diagram.js'),
    ...moduleNameMapper,
  },
}
