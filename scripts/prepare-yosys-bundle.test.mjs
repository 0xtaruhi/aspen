import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  bundleMatches,
  fileInventory,
  isWindowsSystemDll,
  publishBundle,
} from './prepare-yosys-bundle.mjs'

const roots = []
const expected = {
  schema: 1,
  sourceCommit: 'pinned-commit',
  recipe: 'recipe',
  platform: 'darwin',
  arch: 'arm64',
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aspen-yosys-cache-test-'))
  roots.push(root)
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'share'))
  writeFileSync(join(root, 'bin', 'yosys'), 'executable')
  writeFileSync(join(root, 'share', 'techmap.v'), 'technology mapping')
  writeFileSync(
    join(root, 'aspen-build.json'),
    JSON.stringify({ ...expected, buildKey: 'compiler-a', files: fileInventory(root) }),
  )
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Yosys installation cache', () => {
  it('accepts a complete installation after moving it to a different directory', () => {
    const original = fixture()
    // Avoid copying a directory into itself.
    const target = mkdtempSync(join(tmpdir(), 'aspen-yosys-relocated-'))
    roots.push(target)
    cpSync(original, target, { recursive: true })
    expect(bundleMatches(target, expected, 'compiler-a')).toBe(true)
  })

  it.each(['sourceCommit', 'recipe', 'platform', 'arch'])('rejects a different %s', (key) => {
    expect(bundleMatches(fixture(), { ...expected, [key]: 'different' })).toBe(false)
  })

  it('invalidates a local build when the compiler configuration changes', () => {
    expect(bundleMatches(fixture(), expected, 'compiler-b')).toBe(false)
  })

  it('rejects corrupted, missing, and unexpected installation files', () => {
    const root = fixture()
    writeFileSync(join(root, 'bin', 'yosys'), 'damaged executable')
    expect(bundleMatches(root, expected)).toBe(false)
    writeFileSync(join(root, 'bin', 'yosys'), 'executable')
    rmSync(join(root, 'share', 'techmap.v'))
    expect(bundleMatches(root, expected)).toBe(false)
    writeFileSync(join(root, 'share', 'techmap.v'), 'technology mapping')
    writeFileSync(join(root, 'bin', 'extra.dll'), 'unexpected dependency')
    expect(bundleMatches(root, expected)).toBe(false)
  })

  it('allows signing to change packaged executables while still checking data files', () => {
    const root = fixture()
    writeFileSync(join(root, 'bin', 'yosys'), 'signed executable')
    expect(bundleMatches(root, expected)).toBe(false)
    expect(bundleMatches(root, expected, undefined, true)).toBe(true)
    writeFileSync(join(root, 'share', 'techmap.v'), 'damaged mapping')
    expect(bundleMatches(root, expected, undefined, true)).toBe(false)
  })

  it('preserves the current bundle when staging a replacement fails', () => {
    const root = fixture()
    expect(() => publishBundle(join(root, 'missing-installation'), root)).toThrow()
    expect(bundleMatches(root, expected)).toBe(true)
  })

  it('accepts artifact transport without the Git placeholder', () => {
    const root = fixture()
    writeFileSync(join(root, '.placeholder'), 'Git directory marker')
    expect(bundleMatches(root, expected)).toBe(true)
    rmSync(join(root, '.placeholder'))
    expect(existsSync(join(root, '.placeholder'))).toBe(false)
    expect(bundleMatches(root, expected)).toBe(true)
  })

  it('does not accept legacy downloads without build metadata', () => {
    const root = fixture()
    rmSync(join(root, 'aspen-build.json'))
    expect(bundleMatches(root, expected)).toBe(false)
  })
})

describe('Windows runtime distribution', () => {
  it('requires compiler runtimes to be bundled even if installed on the build machine', () => {
    for (const name of [
      'libc++.dll',
      'libwinpthread-1.dll',
      'MSVCR100.dll',
      'VCRUNTIME140.dll',
      'msys-2.0.dll',
    ]) {
      expect(isWindowsSystemDll(name)).toBe(false)
    }
    for (const name of ['KERNEL32.dll', 'ucrtbase.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']) {
      expect(isWindowsSystemDll(name)).toBe(true)
    }
  })
})
