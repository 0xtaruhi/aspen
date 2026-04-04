#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const bundleTargetDir = join(repoRoot, 'src-tauri', 'vendor', 'fde')
const bundleBinDir = join(bundleTargetDir, 'bin')
const bundledResourceDir = join(repoRoot, 'src-tauri', 'resource', 'fde', 'hw_lib')
const preferredSourceDir = process.env.FDE_RS_DIR?.trim()
const upstreamRepoUrl = process.env.FDE_RS_REPO?.trim() || 'https://github.com/0xtaruhi/fde-rs.git'
const executableName = process.platform === 'win32' ? 'fde.exe' : 'fde'

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const sourceRoot = resolveSourceRoot()
  const workingRoot = prepareSourceTree(sourceRoot)
  const workingSource = join(workingRoot, 'source')
  const bundledBinaryPath = join(bundleBinDir, executableName)

  rmSync(bundleTargetDir, { recursive: true, force: true })
  rmSync(bundledResourceDir, { recursive: true, force: true })
  mkdirSync(bundleBinDir, { recursive: true })

  buildRustFde(workingSource)
  copyRustFdeBinary(workingSource, bundledBinaryPath)
  copyBundledResources(workingSource, bundledResourceDir)
  ensurePlaceholder(bundleTargetDir)
  normalizeBundlePermissions(bundleTargetDir)
  validateBundledFde(bundledBinaryPath)

  const bundleBytes = getDirectorySize(bundleTargetDir) + getDirectorySize(bundledResourceDir)
  rmSync(workingRoot, { recursive: true, force: true })

  console.log(
    `Bundled Rust fde toolchain into ${bundleTargetDir} and ${bundledResourceDir} (${formatBytes(bundleBytes)}).`,
  )
}

function resolveSourceRoot() {
  const candidates = [
    preferredSourceDir,
    join(repoRoot, '..', 'fde-rs-standalone'),
    join(repoRoot, '..', 'fde-rs'),
  ]
    .filter(Boolean)
    .map((candidate) => resolve(candidate))

  for (const candidate of candidates) {
    if (looksLikeFdeRsRepo(candidate)) {
      return candidate
    }
  }

  const cloneRoot = join(tmpdir(), `aspen-fde-rs-source-${process.pid}-${Date.now()}`)
  const cloneResult = spawnSync('git', ['clone', '--depth', '1', upstreamRepoUrl, cloneRoot], {
    stdio: 'inherit',
  })
  if (cloneResult.status !== 0) {
    throw new Error(`Failed to clone fde-rs from ${upstreamRepoUrl}.`)
  }

  if (!looksLikeFdeRsRepo(cloneRoot)) {
    throw new Error(`Cloned repository at ${cloneRoot} does not look like fde-rs.`)
  }

  return cloneRoot
}

function looksLikeFdeRsRepo(candidate) {
  return (
    Boolean(candidate) &&
    existsSync(join(candidate, 'Cargo.toml')) &&
    existsSync(join(candidate, 'src')) &&
    existsSync(join(candidate, 'resources', 'hw_lib'))
  )
}

function prepareSourceTree(sourceRoot) {
  const workingRoot = join(tmpdir(), `aspen-fde-rs-build-${process.pid}-${Date.now()}`)
  const workingSource = join(workingRoot, 'source')
  rmSync(workingRoot, { recursive: true, force: true })
  mkdirSync(workingRoot, { recursive: true })
  cpSync(sourceRoot, workingSource, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => shouldCopySourcePath(sourceRoot, sourcePath),
  })
  return workingRoot
}

function shouldCopySourcePath(sourceRoot, sourcePath) {
  if (sourcePath === sourceRoot) {
    return true
  }

  const name = basename(sourcePath)
  return !['.git', '.github', 'target', 'node_modules', 'build', 'dist', '.DS_Store'].includes(name)
}

function buildRustFde(sourceRoot) {
  const result = spawnSync('cargo', ['build', '--release', '--locked', '--bin', 'fde'], {
    cwd: sourceRoot,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`Failed to build Rust fde in ${sourceRoot}.`)
  }
}

function copyRustFdeBinary(sourceRoot, bundledBinaryPath) {
  const builtBinaryPath = join(sourceRoot, 'target', 'release', executableName)
  if (!existsSync(builtBinaryPath)) {
    throw new Error(`Built Rust fde binary was not found at ${builtBinaryPath}.`)
  }

  copyFileSync(builtBinaryPath, bundledBinaryPath)
}

function copyBundledResources(sourceRoot, targetDir) {
  const resourceRoot = join(sourceRoot, 'resources', 'hw_lib')
  if (!existsSync(resourceRoot)) {
    throw new Error(`Rust fde resources were not found at ${resourceRoot}.`)
  }

  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(resourceRoot, targetDir, { recursive: true, dereference: true })
}

function ensurePlaceholder(targetDir) {
  writeFileSync(
    join(targetDir, '.placeholder'),
    'This file keeps the bundled FDE resource directory in git.\n',
  )
}

function normalizeBundlePermissions(targetDir) {
  if (!existsSync(targetDir)) {
    return
  }

  const pending = [targetDir]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) {
      continue
    }

    const stat = lstatSync(current)
    if (stat.isDirectory()) {
      chmodSync(current, 0o755)
      for (const entry of readdirSync(current)) {
        pending.push(join(current, entry))
      }
      continue
    }

    chmodSync(current, executableBitMode(current))
  }
}

function executableBitMode(path) {
  if (basename(path) === executableName) {
    return 0o755
  }
  return 0o644
}

function validateBundledFde(bundledBinaryPath) {
  const result = spawnSync(bundledBinaryPath, ['--version'], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Bundled Rust fde failed validation at ${bundledBinaryPath}.`)
  }
}

function getDirectorySize(root) {
  if (!existsSync(root)) {
    return 0
  }

  const stat = lstatSync(root)
  if (!stat.isDirectory()) {
    return stat.size
  }

  let total = 0
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) {
      continue
    }

    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry)
      const entryStat = lstatSync(entryPath)
      if (entryStat.isDirectory()) {
        pending.push(entryPath)
      } else {
        total += entryStat.size
      }
    }
  }

  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  }
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}
