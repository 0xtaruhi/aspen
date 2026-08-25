import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertVersionConsistency,
  planVersionUpdate,
  readProjectVersions,
} from './prepare-release.mjs'

const fixtures = []

function createFixture(version = '0.5.1') {
  const root = mkdtempSync(resolve(tmpdir(), 'aspen-release-'))
  fixtures.push(root)
  mkdirSync(resolve(root, 'src-tauri'))
  writeFileSync(
    resolve(root, 'package.json'),
    `{\n  "version": "${version}",\n  "name": "aspen"\n}\n`,
  )
  writeFileSync(resolve(root, 'src-tauri/Cargo.toml'), `[package]\nversion = "${version}"\n`)
  writeFileSync(
    resolve(root, 'src-tauri/Cargo.lock'),
    `[[package]]\nname = "aspen"\nversion = "${version}"\n`,
  )
  writeFileSync(
    resolve(root, 'src-tauri/tauri.conf.json'),
    `{\n  "version": "${version}",\n  "productName": "Aspen"\n}\n`,
  )
  return root
}

function createGitFixture() {
  const root = createFixture()
  const remote = mkdtempSync(resolve(tmpdir(), 'aspen-release-remote-'))
  fixtures.push(remote)
  mkdirSync(resolve(root, 'scripts'))
  copyFileSync(
    fileURLToPath(new URL('./prepare-release.mjs', import.meta.url)),
    resolve(root, 'scripts/prepare-release.mjs'),
  )
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '-b', 'main')
  git('add', '.')
  git(
    '-c',
    'user.name=Aspen Tests',
    '-c',
    'user.email=aspen@example.invalid',
    'commit',
    '-m',
    'fixture',
  )
  git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote)
  return { root, git }
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('release preparation', () => {
  it('updates every Aspen version source together', () => {
    const root = createFixture()
    for (const [path, content] of planVersionUpdate('0.6.0', root)) {
      writeFileSync(resolve(root, path), content)
    }

    expect(readProjectVersions(root)).toEqual({
      package: '0.6.0',
      cargo: '0.6.0',
      lock: '0.6.0',
      tauri: '0.6.0',
    })
  })

  it('creates a release branch from a clean default branch', () => {
    const { root, git } = createGitFixture()

    execFileSync(process.execPath, ['scripts/prepare-release.mjs', '0.6.0'], {
      cwd: root,
      stdio: 'pipe',
    })

    expect(git('branch', '--show-current')).toBe('release/v0.6.0')
    expect(new Set(Object.values(readProjectVersions(root)))).toEqual(new Set(['0.6.0']))
  })

  it.each(['branch', 'tag'])('rejects a remote-only release %s', (kind) => {
    const { root, git } = createGitFixture()
    const ref = kind === 'branch' ? 'release/v0.6.0' : 'v0.6.0'
    git(kind, ref)
    git('push', 'origin', ref)
    git(kind, '-d', ref)

    expect(() =>
      execFileSync(process.execPath, ['scripts/prepare-release.mjs', '0.6.0'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).toThrow()
  })

  it('rejects inconsistent or older versions', () => {
    const root = createFixture()
    writeFileSync(
      resolve(root, 'src-tauri/tauri.conf.json'),
      '{\n  "version": "0.5.0",\n  "productName": "Aspen"\n}\n',
    )
    expect(() => assertVersionConsistency(root)).toThrow('Aspen versions differ')

    const consistentRoot = createFixture()
    expect(() => planVersionUpdate('0.5.0', consistentRoot)).toThrow('must be newer')
    expect(() => planVersionUpdate('v0.6.0', consistentRoot)).toThrow('expected X.Y.Z')
  })
})
