import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const files = {
  package: 'package.json',
  cargo: 'src-tauri/Cargo.toml',
  lock: 'src-tauri/Cargo.lock',
  tauri: 'src-tauri/tauri.conf.json',
}

function read(root, path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function replaceOne(text, pattern, replacement, label) {
  if ((text.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? []).length !== 1) {
    throw new Error(`Could not identify exactly one ${label} version field`)
  }
  return text.replace(pattern, replacement)
}

export function readProjectVersions(root = repoRoot) {
  const cargo = read(root, files.cargo)
  const lock = read(root, files.lock)
  const cargoVersion = /^version = "([^"]+)"$/m.exec(cargo)?.[1]
  const lockVersion = /^\[\[package\]\]\nname = "aspen"\nversion = "([^"]+)"$/m.exec(lock)?.[1]

  if (!cargoVersion || !lockVersion) throw new Error('Could not read Aspen Cargo versions')

  return {
    package: JSON.parse(read(root, files.package)).version,
    cargo: cargoVersion,
    lock: lockVersion,
    tauri: JSON.parse(read(root, files.tauri)).version,
  }
}

export function assertVersionConsistency(root = repoRoot) {
  const versions = readProjectVersions(root)
  const unique = new Set(Object.values(versions))
  if (unique.size !== 1) {
    throw new Error(
      `Aspen versions differ: ${Object.entries(versions)
        .map(([name, version]) => `${name}=${version}`)
        .join(', ')}`,
    )
  }
  return versions.package
}

export function planVersionUpdate(nextVersion, root = repoRoot) {
  const match = versionPattern.exec(nextVersion)
  if (!match) throw new Error(`Invalid release version '${nextVersion}'; expected X.Y.Z`)

  const currentVersion = assertVersionConsistency(root)
  if (!versionPattern.test(currentVersion)) {
    throw new Error(`Current Aspen version '${currentVersion}' is not X.Y.Z`)
  }
  const current = currentVersion.split('.').map(Number)
  const next = match.slice(1).map(Number)
  const changedIndex = next.findIndex((part, index) => part !== current[index])
  if (changedIndex < 0 || next[changedIndex] < current[changedIndex]) {
    throw new Error(`Release version ${nextVersion} must be newer than ${currentVersion}`)
  }

  return new Map([
    [
      files.package,
      replaceOne(
        read(root, files.package),
        /^[ ]{2}"version": "[^"]+",$/m,
        `  "version": "${nextVersion}",`,
        'package.json',
      ),
    ],
    [
      files.cargo,
      replaceOne(
        read(root, files.cargo),
        /^version = "[^"]+"$/m,
        `version = "${nextVersion}"`,
        'Cargo.toml',
      ),
    ],
    [
      files.lock,
      replaceOne(
        read(root, files.lock),
        /^(\[\[package\]\]\nname = "aspen"\nversion = ")[^"]+("$)/m,
        `$1${nextVersion}$2`,
        'Cargo.lock',
      ),
    ],
    [
      files.tauri,
      replaceOne(
        read(root, files.tauri),
        /^[ ]{2}"version": "[^"]+",$/m,
        `  "version": "${nextVersion}",`,
        'tauri.conf.json',
      ),
    ],
  ])
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function refExists(ref) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: repoRoot }).status === 0
}

function remoteRefExists(ref) {
  const result = spawnSync('git', ['ls-remote', '--exit-code', 'origin', ref], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status === 0) return true
  if (result.status === 2) return false
  throw new Error(result.stderr.trim() || `Could not query origin for ${ref}`)
}

function prepareRelease(version) {
  if (git('status', '--porcelain')) throw new Error('Working tree must be clean')

  const currentBranch = git('branch', '--show-current')
  if (!['main', 'master'].includes(currentBranch)) {
    throw new Error(`Run release preparation from main or master, not '${currentBranch}'`)
  }

  const branch = `release/v${version}`
  if (refExists(`refs/heads/${branch}`) || remoteRefExists(`refs/heads/${branch}`)) {
    throw new Error(`Branch '${branch}' already exists`)
  }
  if (refExists(`refs/tags/v${version}`) || remoteRefExists(`refs/tags/v${version}`)) {
    throw new Error(`Tag 'v${version}' already exists`)
  }

  const updates = planVersionUpdate(version)
  git('switch', '-c', branch)
  for (const [path, content] of updates) writeFileSync(resolve(repoRoot, path), content)
  assertVersionConsistency()

  console.log(`Prepared Aspen ${version} on ${branch}.`)
  console.log(`Next: review the four version changes, commit them, and open a PR.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (version === '--check') {
    console.log(`Aspen version ${assertVersionConsistency()} is consistent.`)
  } else if (version) {
    prepareRelease(version)
  } else {
    throw new Error('Usage: pnpm release:prepare X.Y.Z')
  }
}
