#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const bundleTargetDir = join(repoRoot, 'src-tauri', 'vendor', 'yosys')
const releaseRepo = 'YosysHQ/oss-cad-suite-build'
const explicitVersion = process.env.OSS_CAD_SUITE_VERSION?.trim()
const targetAssetHint = resolveTargetAssetHint()
const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.YOSYS_GITHUB_TOKEN?.trim() || ''
const args = new Set(process.argv.slice(2))

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  if (args.has('--prune-existing')) {
    if (!existsSync(bundleTargetDir)) {
      throw new Error(`No bundled Yosys toolchain found at ${bundleTargetDir}.`)
    }

    const beforeBytes = getDirectorySize(bundleTargetDir)
    materializeBundledSymlinks(bundleTargetDir)
    pruneBundledToolchain(bundleTargetDir)
    ensureBundlePlaceholder(bundleTargetDir)
    validateBundledYosys(bundleTargetDir)
    const afterBytes = getDirectorySize(bundleTargetDir)
    console.log(
      `Pruned existing bundled Yosys from ${formatBytes(beforeBytes)} to ${formatBytes(afterBytes)}.`,
    )
    return
  }

  const { release, asset } = await resolveReleaseAndAsset()
  const downloadDir = join(tmpdir(), `aspen-yosys-${process.pid}-${Date.now()}`)
  const archivePath = join(downloadDir, asset.name)
  const extractDir = join(downloadDir, 'extract')

  rmSync(downloadDir, { recursive: true, force: true })
  mkdirSync(downloadDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })

  console.log(`Downloading ${asset.name} from ${asset.browser_download_url}`)
  const downloadStartedAt = Date.now()
  await downloadFile(asset.browser_download_url, archivePath)
  console.log(`Downloaded ${asset.name} in ${formatDuration(Date.now() - downloadStartedAt)}.`)
  const extractStartedAt = Date.now()
  extractArchive(archivePath, extractDir)
  console.log(`Extracted ${asset.name} in ${formatDuration(Date.now() - extractStartedAt)}.`)

  const extractedRoot = findToolchainRoot(extractDir)
  const bundleStartedAt = Date.now()
  rmSync(bundleTargetDir, { recursive: true, force: true })
  mkdirSync(dirname(bundleTargetDir), { recursive: true })
  cpSync(extractedRoot, bundleTargetDir, { recursive: true, dereference: true })
  materializeBundledSymlinks(bundleTargetDir)
  pruneBundledToolchain(bundleTargetDir)
  ensureBundlePlaceholder(bundleTargetDir)
  validateBundledYosys(bundleTargetDir)
  console.log(
    `Prepared and validated bundled Yosys in ${formatDuration(Date.now() - bundleStartedAt)}.`,
  )
  const bundledBytes = getDirectorySize(bundleTargetDir)
  rmSync(downloadDir, { recursive: true, force: true })

  console.log(
    `Bundled official OSS CAD Suite ${release.tag_name} (${asset.name}) into ${bundleTargetDir} (${formatBytes(bundledBytes)}).`,
  )
}

function resolveTargetAssetHint() {
  const platform = process.env.OSS_CAD_SUITE_PLATFORM?.trim() || process.platform
  const arch = process.env.OSS_CAD_SUITE_ARCH?.trim() || process.arch

  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64'
  }
  if (platform === 'darwin' && (arch === 'x64' || arch === 'amd64')) {
    return 'darwin-x64'
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'amd64')) {
    return 'linux-x64'
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'linux-arm64'
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'amd64')) {
    return 'windows-x64'
  }
  if (platform === 'win32' && arch === 'arm64') {
    return 'windows-arm64'
  }

  throw new Error(
    `Unsupported platform '${platform}' / '${arch}' for bundled OSS CAD Suite download.`,
  )
}

async function resolveReleaseAndAsset() {
  if (explicitVersion) {
    const release = await fetchJson(
      `https://api.github.com/repos/${releaseRepo}/releases/tags/${encodeURIComponent(explicitVersion)}`,
      'release metadata',
    )
    if (!release || !Array.isArray(release.assets)) {
      throw new Error('OSS CAD Suite release metadata did not contain an asset list.')
    }

    return {
      release,
      asset: selectAsset(release.assets),
    }
  }

  const releases = await fetchJson(
    `https://api.github.com/repos/${releaseRepo}/releases?per_page=12`,
    'release list',
  )
  if (!Array.isArray(releases)) {
    throw new Error('OSS CAD Suite release list did not contain a valid array payload.')
  }

  for (const release of releases) {
    if (!release || !Array.isArray(release.assets)) {
      continue
    }

    const asset = selectAsset(release.assets, { allowMissing: true })
    if (asset) {
      return { release, asset }
    }
  }

  throw new Error(
    `No recent OSS CAD Suite release contained a '${targetAssetHint}' archive for this platform.`,
  )
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      'User-Agent': 'aspen-yosys-bundler',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OSS CAD Suite ${label} (${response.status} ${response.statusText}).`,
    )
  }

  return response.json()
}

function selectAsset(assets, { allowMissing = false } = {}) {
  const normalizedHint = targetAssetHint.toLowerCase()
  const preferredExtensions = targetAssetHint.startsWith('windows-')
    ? ['.exe', '.zip', '.tgz']
    : ['.tgz', '.zip']
  const candidates = assets.filter((asset) => {
    const name = String(asset.name || '').toLowerCase()
    return (
      name.includes(normalizedHint) &&
      preferredExtensions.some((extension) => name.endsWith(extension))
    )
  })

  if (candidates.length === 0) {
    if (allowMissing) {
      return null
    }

    throw new Error(`No OSS CAD Suite asset matched '${targetAssetHint}' in the selected release.`)
  }

  for (const extension of preferredExtensions) {
    const asset = candidates.find((candidate) =>
      String(candidate.name || '')
        .toLowerCase()
        .endsWith(extension),
    )
    if (asset) {
      return asset
    }
  }

  return candidates[0]
}

async function downloadFile(url, destinationPath) {
  if (tryNativeDownload(url, destinationPath)) {
    return
  }

  const response = await fetch(url, {
    headers: {
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      'User-Agent': 'aspen-yosys-bundler',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download OSS CAD Suite archive (${response.status}).`)
  }

  if (!response.body) {
    throw new Error('OSS CAD Suite download response did not include a body.')
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath))
}

function tryNativeDownload(url, destinationPath) {
  if (process.platform === 'win32') {
    const curlResult = spawnSync('curl.exe', ['-L', '--fail', '--output', destinationPath, url], {
      stdio: 'inherit',
    })
    if (curlResult.status === 0) {
      return true
    }

    const powershellResult = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Invoke-WebRequest -Uri "${url}" -OutFile "${destinationPath}"`],
      { stdio: 'inherit' },
    )
    return powershellResult.status === 0
  }

  const result = spawnSync('curl', ['-L', '--fail', '--output', destinationPath, url], {
    stdio: 'inherit',
  })
  return result.status === 0
}

function extractArchive(archivePath, extractDir) {
  if (archivePath.toLowerCase().endsWith('.exe')) {
    const sevenZipResult = spawnSync('7z', ['x', archivePath, `-o${extractDir}`, '-y'], {
      stdio: 'inherit',
    })
    if (sevenZipResult.status === 0) {
      return
    }

    throw new Error(`Failed to extract ${basename(archivePath)}.`)
  }

  if (archivePath.toLowerCase().endsWith('.zip')) {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${extractDir}" -Force`,
        ],
        { stdio: 'inherit' },
      )
      if (result.status === 0) {
        return
      }
    }

    const unzipResult = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], {
      stdio: 'inherit',
    })
    if (unzipResult.status === 0) {
      return
    }

    throw new Error(`Failed to extract ${basename(archivePath)}.`)
  }

  const tarResult = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], {
    stdio: 'inherit',
  })
  if (tarResult.status !== 0) {
    throw new Error(`Failed to extract ${basename(archivePath)}.`)
  }
}

function findToolchainRoot(rootDir) {
  const queue = [rootDir]
  while (queue.length > 0) {
    const currentDir = queue.shift()
    if (!currentDir) {
      continue
    }

    if (containsYosysBinary(currentDir)) {
      return currentDir
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        queue.push(join(currentDir, entry.name))
      }
    }
  }

  throw new Error('Downloaded OSS CAD Suite archive did not contain a usable Yosys toolchain.')
}

function containsYosysBinary(directory) {
  const executableName = process.platform === 'win32' ? 'yosys.exe' : 'yosys'
  return existsSync(join(directory, 'bin', executableName))
}

function ensureBundlePlaceholder(bundleRoot) {
  writeFileSync(
    join(bundleRoot, '.placeholder'),
    'This file keeps the bundled Yosys resource directory in git.\n',
  )
}

function pruneBundledToolchain(bundleRoot) {
  const keepRootEntries = new Set([
    'README',
    'VERSION',
    'bin',
    'lib',
    'libexec',
    'license',
    'share',
  ])
  if (process.platform === 'linux' && existsSync(join(bundleRoot, 'lib64'))) {
    keepRootEntries.add('lib64')
  }
  if (process.platform === 'win32') {
    keepRootEntries.add('environment.bat')
    keepRootEntries.add('start.bat')
  }
  pruneChildren(bundleRoot, keepRootEntries)
  const prunePlan = buildPrunePlan(bundleRoot)
  pruneBinDirectory(join(bundleRoot, 'bin'), prunePlan.binEntries)
  pruneLibexecDirectory(join(bundleRoot, 'libexec'), prunePlan.libexecEntries)
  pruneShareDirectory(join(bundleRoot, 'share'))
  pruneLibraryDirectories(bundleRoot, prunePlan)
}

function buildPrunePlan(bundleRoot) {
  const runtimeTargets = getRuntimeTargetPaths(bundleRoot)
  const dependencyPaths = collectBundledDependencies(bundleRoot, runtimeTargets)
  const wrapperDependencies = collectShellWrapperDependencies(bundleRoot)
  const bundledDependencies = [...runtimeTargets, ...dependencyPaths, ...wrapperDependencies]
  const binEntries = new Set(['yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  const libexecEntries = new Set(['realpath', 'yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  const libEntries = new Set(
    ['tcl8.6', 'tk8.6'].filter((entry) => existsSync(join(bundleRoot, 'lib', entry))),
  )
  const lib64Entries = new Set()
  const frameworkEntries = new Set()

  if (process.platform === 'linux') {
    addLinuxLoaderEntries(join(bundleRoot, 'lib'), libEntries)
    addLinuxLoaderEntries(join(bundleRoot, 'lib64'), lib64Entries)
    if (existsSync(join(bundleRoot, 'lib', 'yosys'))) {
      libEntries.add('yosys')
    }
    if (existsSync(join(bundleRoot, 'lib', 'yosys-abc'))) {
      libEntries.add('yosys-abc')
    }
  }

  for (const dependencyPath of bundledDependencies) {
    const relPath = relative(bundleRoot, dependencyPath)
    const [topLevelDir, firstChild] = relPath.split(/[\\/]/, 2)
    if (!topLevelDir || !firstChild) {
      continue
    }

    if (topLevelDir === 'bin') {
      binEntries.add(firstChild)
      continue
    }

    if (topLevelDir === 'libexec') {
      libexecEntries.add(firstChild)
      continue
    }

    if (topLevelDir === 'lib') {
      libEntries.add(firstChild)
      continue
    }

    if (topLevelDir === 'lib64') {
      lib64Entries.add(firstChild)
      continue
    }

    if (topLevelDir === 'Frameworks') {
      frameworkEntries.add(firstChild)
    }
  }

  return {
    binEntries,
    libexecEntries,
    libEntries,
    lib64Entries,
    frameworkEntries,
  }
}

function addLinuxLoaderEntries(libDir, keepEntries) {
  if (!existsSync(libDir)) {
    return
  }

  for (const entry of readdirSync(libDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      continue
    }

    if (/^ld-linux[-A-Za-z0-9._]*\.so(?:\.\d+)*$/i.test(entry.name)) {
      keepEntries.add(entry.name)
    }
  }
}

function pruneBinDirectory(binDir, keepEntries) {
  if (!existsSync(binDir)) {
    return
  }

  const keep = keepEntries ?? new Set(['yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  for (const entry of readdirSync(binDir, { withFileTypes: true })) {
    if (keep.has(entry.name)) {
      continue
    }

    if (entry.isDirectory()) {
      removeEntry(join(binDir, entry.name))
      continue
    }

    removeEntry(join(binDir, entry.name))
  }
}

function pruneLibexecDirectory(libexecDir, keepEntries) {
  if (!existsSync(libexecDir)) {
    return
  }

  const keep =
    keepEntries ?? new Set(['realpath', 'yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  for (const entry of readdirSync(libexecDir, { withFileTypes: true })) {
    if (keep.has(entry.name)) {
      continue
    }

    if (entry.isDirectory()) {
      removeEntry(join(libexecDir, entry.name))
      continue
    }

    removeEntry(join(libexecDir, entry.name))
  }
}

function pruneShareDirectory(shareDir) {
  if (!existsSync(shareDir)) {
    return
  }

  pruneChildren(shareDir, new Set(['terminfo', 'yosys']))
}

function pruneLibraryDirectories(bundleRoot, prunePlan) {
  const libDir = join(bundleRoot, 'lib')
  if (existsSync(libDir)) {
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (prunePlan.libEntries.has(entry.name)) {
        continue
      }
      removeEntry(join(libDir, entry.name))
    }
  }

  const lib64Dir = join(bundleRoot, 'lib64')
  if (existsSync(lib64Dir)) {
    for (const entry of readdirSync(lib64Dir, { withFileTypes: true })) {
      if (prunePlan.lib64Entries.has(entry.name)) {
        continue
      }
      removeEntry(join(lib64Dir, entry.name))
    }
  }

  const frameworksDir = join(bundleRoot, 'Frameworks')
  if (existsSync(frameworksDir)) {
    if (prunePlan.frameworkEntries.size === 0) {
      removeEntry(frameworksDir)
      return
    }

    for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
      if (prunePlan.frameworkEntries.has(entry.name)) {
        continue
      }
      removeEntry(join(frameworksDir, entry.name))
    }
  }
}

function pruneChildren(dirPath, keepNames) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (keepNames.has(entry.name)) {
      continue
    }
    removeEntry(join(dirPath, entry.name))
  }
}

function materializeBundledSymlinks(rootDir) {
  if (!existsSync(rootDir)) {
    return
  }

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name)
    const stats = lstatSync(entryPath)

    if (stats.isSymbolicLink()) {
      const linkTarget = readlinkSync(entryPath)
      const resolvedTarget = resolve(dirname(entryPath), linkTarget)
      removeEntry(entryPath)

      if (!existsSync(resolvedTarget)) {
        continue
      }

      cpSync(resolvedTarget, entryPath, { recursive: true, dereference: true })
      continue
    }

    if (entry.isDirectory()) {
      materializeBundledSymlinks(entryPath)
    }
  }
}

function removeEntry(entryPath) {
  const stats = lstatSync(entryPath)
  if (stats.isSymbolicLink()) {
    unlinkSync(entryPath)
    return
  }

  rmSync(entryPath, {
    recursive: stats.isDirectory(),
    force: true,
  })
}

function getRuntimeTargetPaths(bundleRoot) {
  const candidates = [
    join(bundleRoot, 'lib', 'yosys'),
    join(bundleRoot, 'lib', 'yosys-abc'),
    join(bundleRoot, 'libexec', 'yosys'),
    join(bundleRoot, 'libexec', 'yosys-abc'),
    join(bundleRoot, 'libexec', 'realpath'),
    join(bundleRoot, 'bin', 'yosys.exe'),
    join(bundleRoot, 'bin', 'yosys-abc.exe'),
    join(bundleRoot, 'bin', 'yosys'),
    join(bundleRoot, 'bin', 'yosys-abc'),
  ]

  return candidates.filter((candidate) => {
    if (!existsSync(candidate)) {
      return false
    }

    if (!isShellScript(candidate)) {
      return true
    }

    const relPath = relative(bundleRoot, candidate)
    return relPath.startsWith('lib/') || relPath.startsWith('lib\\')
  })
}

function isShellScript(filePath) {
  if (process.platform === 'win32') {
    return false
  }

  const result = spawnSync('file', [filePath], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.toLowerCase().includes('shell script')
}

function collectBundledDependencies(bundleRoot, runtimeTargets) {
  const queue = [...runtimeTargets]
  const seen = new Set(queue.map((entry) => resolve(entry)))

  while (queue.length > 0) {
    const currentPath = queue.pop()
    if (!currentPath) {
      continue
    }

    for (const dependency of inspectDependencies(currentPath, bundleRoot)) {
      const resolvedDependency = resolve(dependency)
      if (seen.has(resolvedDependency) || !existsSync(resolvedDependency)) {
        continue
      }
      seen.add(resolvedDependency)
      queue.push(resolvedDependency)
    }
  }

  return seen
}

function collectShellWrapperDependencies(bundleRoot) {
  const wrappers = [
    join(bundleRoot, 'bin', 'yosys'),
    join(bundleRoot, 'bin', 'yosys-abc'),
    join(bundleRoot, 'lib', 'yosys'),
    join(bundleRoot, 'lib', 'yosys-abc'),
  ]
  const discovered = new Set()

  for (const wrapperPath of wrappers) {
    if (!existsSync(wrapperPath) || !isShellScript(wrapperPath)) {
      continue
    }

    const contents = readFileSync(wrapperPath, 'utf8')
    for (const match of contents.matchAll(/\.\.\/(?:lib|lib64|libexec)\/[A-Za-z0-9._/+:-]+/g)) {
      const rawDependency = match[0]
      const normalizedDependency = rawDependency.split('/').filter(Boolean)
      const resolvedDependency = resolve(dirname(wrapperPath), ...normalizedDependency)
      if (!resolvedDependency.startsWith(bundleRoot)) {
        continue
      }
      discovered.add(resolvedDependency)
    }
  }

  return [...discovered]
}

function inspectDependencies(filePath, bundleRoot) {
  if (process.platform === 'darwin') {
    const result = spawnSync('otool', ['-L', filePath], { encoding: 'utf8' })
    if (result.status !== 0) {
      return []
    }

    return result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(' (')[0])
      .map((dependency) => resolveBundledDependency(filePath, dependency, bundleRoot))
      .filter(Boolean)
  }

  if (process.platform === 'linux') {
    const result = spawnSync('ldd', [filePath], { encoding: 'utf8' })
    if (result.status !== 0) {
      return []
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.includes('=>')) {
          return line.split('=>')[1]?.trim().split(' (')[0] ?? ''
        }
        return line.split(' (')[0]
      })
      .map((dependency) => resolveBundledDependency(filePath, dependency, bundleRoot))
      .filter(Boolean)
  }

  if (process.platform === 'win32') {
    return collectWindowsDependencyNames(filePath)
      .map((dependency) => resolveWindowsBundledDependency(filePath, dependency, bundleRoot))
      .filter(Boolean)
  }

  return []
}

function collectWindowsDependencyNames(filePath) {
  for (const tool of ['dumpbin', 'llvm-objdump']) {
    const resolvedTool = resolveToolPath(tool)
    if (!resolvedTool) {
      continue
    }

    const args = tool === 'dumpbin' ? ['/dependents', filePath] : ['-p', filePath]
    const result = spawnSync(resolvedTool, args, {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.status !== 0) {
      continue
    }

    const dependencyNames =
      tool === 'dumpbin'
        ? result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /\.dll$/i.test(line))
        : result.stdout
            .split(/\r?\n/)
            .map((line) => line.match(/DLL Name:\s+(.+)$/)?.[1]?.trim())
            .filter(Boolean)
    if (dependencyNames.length > 0) {
      return dependencyNames
    }
  }

  return parsePortableExecutableDependencyNames(filePath)
}

function resolveWindowsBundledDependency(filePath, dependencyName, bundleRoot) {
  const lowerName = String(dependencyName).toLowerCase()
  if (WINDOWS_SYSTEM_DLLS.has(lowerName)) {
    return null
  }

  const sameDirCandidate = join(dirname(filePath), dependencyName)
  if (existsSync(sameDirCandidate)) {
    return sameDirCandidate
  }

  const fileIndex = getBundledFileIndex(bundleRoot)
  const candidates = fileIndex.get(lowerName) ?? []
  if (candidates.length === 0) {
    return null
  }

  candidates.sort((leftPath, rightPath) => {
    const leftDir = dirname(leftPath)
    const rightDir = dirname(rightPath)
    const currentDir = dirname(filePath)
    if (leftDir === currentDir && rightDir !== currentDir) {
      return -1
    }
    if (leftDir !== currentDir && rightDir === currentDir) {
      return 1
    }
    if (
      leftPath.startsWith(join(bundleRoot, 'bin')) &&
      !rightPath.startsWith(join(bundleRoot, 'bin'))
    ) {
      return -1
    }
    if (
      !leftPath.startsWith(join(bundleRoot, 'bin')) &&
      rightPath.startsWith(join(bundleRoot, 'bin'))
    ) {
      return 1
    }
    return leftPath.localeCompare(rightPath)
  })

  return candidates[0] ?? null
}

function resolveToolPath(name) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathEntries = process.env.PATH ? process.env.PATH.split(delimiter) : []

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(entry, `${name}${extension}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

const bundledFileIndexCache = new Map()
const WINDOWS_SYSTEM_DLLS = new Set([
  'advapi32.dll',
  'bcrypt.dll',
  'comdlg32.dll',
  'gdi32.dll',
  'kernel32.dll',
  'ntdll.dll',
  'ole32.dll',
  'secur32.dll',
  'shell32.dll',
  'user32.dll',
  'ws2_32.dll',
])

function getBundledFileIndex(bundleRoot) {
  const normalizedRoot = resolve(bundleRoot)
  const cached = bundledFileIndexCache.get(normalizedRoot)
  if (cached) {
    return cached
  }

  const index = new Map()
  const queue = [normalizedRoot]
  while (queue.length > 0) {
    const currentDir = queue.pop()
    if (!currentDir || !existsSync(currentDir)) {
      continue
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }

      const key = entry.name.toLowerCase()
      const existing = index.get(key) ?? []
      existing.push(entryPath)
      index.set(key, existing)
    }
  }

  bundledFileIndexCache.set(normalizedRoot, index)
  return index
}

function parsePortableExecutableDependencyNames(filePath) {
  const fileBuffer = readFileSync(filePath)
  if (fileBuffer.length < 0x40 || fileBuffer.toString('ascii', 0, 2) !== 'MZ') {
    return []
  }

  const peHeaderOffset = fileBuffer.readUInt32LE(0x3c)
  if (
    peHeaderOffset <= 0 ||
    peHeaderOffset + 0x18 >= fileBuffer.length ||
    fileBuffer.toString('ascii', peHeaderOffset, peHeaderOffset + 4) !== 'PE\u0000\u0000'
  ) {
    return []
  }

  const fileHeaderOffset = peHeaderOffset + 4
  const numberOfSections = fileBuffer.readUInt16LE(fileHeaderOffset + 2)
  const optionalHeaderSize = fileBuffer.readUInt16LE(fileHeaderOffset + 16)
  const optionalHeaderOffset = fileHeaderOffset + 20
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize
  if (sectionTableOffset > fileBuffer.length) {
    return []
  }

  const optionalHeaderMagic = fileBuffer.readUInt16LE(optionalHeaderOffset)
  let dataDirectoryOffset
  if (optionalHeaderMagic === 0x10b) {
    dataDirectoryOffset = optionalHeaderOffset + 96
  } else if (optionalHeaderMagic === 0x20b) {
    dataDirectoryOffset = optionalHeaderOffset + 112
  } else {
    return []
  }

  const sections = []
  for (let index = 0; index < numberOfSections; index += 1) {
    const offset = sectionTableOffset + index * 40
    if (offset + 40 > fileBuffer.length) {
      break
    }

    const virtualSize = fileBuffer.readUInt32LE(offset + 8)
    const virtualAddress = fileBuffer.readUInt32LE(offset + 12)
    const rawSize = fileBuffer.readUInt32LE(offset + 16)
    const rawOffset = fileBuffer.readUInt32LE(offset + 20)
    sections.push({
      rawOffset,
      rawSize,
      virtualAddress,
      virtualSize,
    })
  }

  const importedNames = new Set()
  collectPeImportedDllNames(
    fileBuffer,
    sections,
    readPeDirectoryRva(fileBuffer, dataDirectoryOffset, 1),
    20,
    12,
    importedNames,
  )
  collectPeImportedDllNames(
    fileBuffer,
    sections,
    readPeDirectoryRva(fileBuffer, dataDirectoryOffset, 13),
    32,
    4,
    importedNames,
  )
  return [...importedNames]
}

function readPeDirectoryRva(fileBuffer, dataDirectoryOffset, entryIndex) {
  const entryOffset = dataDirectoryOffset + entryIndex * 8
  if (entryOffset + 8 > fileBuffer.length) {
    return 0
  }
  return fileBuffer.readUInt32LE(entryOffset)
}

function collectPeImportedDllNames(
  fileBuffer,
  sections,
  tableRva,
  descriptorSize,
  nameFieldOffset,
  importedNames,
) {
  if (!tableRva) {
    return
  }

  const tableOffset = portableExecutableRvaToOffset(tableRva, sections)
  if (tableOffset === null) {
    return
  }

  for (
    let descriptorOffset = tableOffset;
    descriptorOffset + descriptorSize <= fileBuffer.length;
    descriptorOffset += descriptorSize
  ) {
    const descriptor = fileBuffer.subarray(descriptorOffset, descriptorOffset + descriptorSize)
    if (descriptor.every((byte) => byte === 0)) {
      break
    }

    const nameRva = descriptor.readUInt32LE(nameFieldOffset)
    const nameOffset = portableExecutableRvaToOffset(nameRva, sections)
    if (nameOffset === null) {
      continue
    }

    const dependencyName = readNullTerminatedAscii(fileBuffer, nameOffset)
    if (dependencyName) {
      importedNames.add(dependencyName)
    }
  }
}

function portableExecutableRvaToOffset(rva, sections) {
  for (const section of sections) {
    const sectionSize = Math.max(section.virtualSize, section.rawSize)
    if (rva >= section.virtualAddress && rva < section.virtualAddress + sectionSize) {
      return section.rawOffset + (rva - section.virtualAddress)
    }
  }

  return null
}

function readNullTerminatedAscii(fileBuffer, offset) {
  if (offset < 0 || offset >= fileBuffer.length) {
    return ''
  }

  let endOffset = offset
  while (endOffset < fileBuffer.length && fileBuffer[endOffset] !== 0) {
    endOffset += 1
  }

  return fileBuffer.toString('ascii', offset, endOffset).trim()
}

function resolveBundledDependency(filePath, dependency, bundleRoot) {
  if (!dependency || dependency === 'not') {
    return null
  }

  let candidate = dependency
  if (dependency.startsWith('@executable_path/')) {
    candidate = resolve(dirname(filePath), dependency.slice('@executable_path/'.length))
  } else if (dependency.startsWith('@loader_path/')) {
    candidate = resolve(dirname(filePath), dependency.slice('@loader_path/'.length))
  }

  if (!candidate.startsWith(bundleRoot)) {
    return null
  }

  return candidate
}

function validateBundledYosys(bundleRoot) {
  const yosysExecutable =
    process.platform === 'win32'
      ? join(bundleRoot, 'bin', 'yosys.exe')
      : join(bundleRoot, 'bin', 'yosys')
  if (!existsSync(yosysExecutable)) {
    throw new Error(`Bundled Yosys executable not found at ${yosysExecutable}.`)
  }

  const validationDir = join(tmpdir(), `aspen-yosys-validate-${process.pid}-${Date.now()}`)
  mkdirSync(validationDir, { recursive: true })

  const topPath = join(validationDir, 'top.v')
  const scriptPath = join(validationDir, 'run.ys')
  const netlistPath = join(validationDir, 'netlist.json')
  writeFileSync(
    topPath,
    [
      'module top(',
      '  input wire clk,',
      '  output reg led',
      ');',
      '  always @(posedge clk) begin',
      '    led <= ~led;',
      '  end',
      'endmodule',
      '',
    ].join('\n'),
  )
  writeFileSync(
    scriptPath,
    [
      `read_verilog -sv "${topPath.replaceAll('\\', '/')}"`,
      'hierarchy -check -top top',
      'synth -top top',
      `write_json "${netlistPath.replaceAll('\\', '/')}"`,
      '',
    ].join('\n'),
  )

  const environmentBatch = join(bundleRoot, 'environment.bat')
  const result =
    process.platform === 'win32' && existsSync(environmentBatch)
      ? runWindowsYosysWithEnvironmentBatch(
          environmentBatch,
          yosysExecutable,
          scriptPath,
          validationDir,
        )
      : spawnSync(yosysExecutable, ['-s', scriptPath], {
          cwd: validationDir,
          encoding: 'utf8',
          env: buildYosysRuntimeEnv(bundleRoot),
        })
  rmSync(validationDir, { recursive: true, force: true })

  if (result.status !== 0) {
    throw new Error(formatSpawnFailure('Bundled Yosys validation failed.', result))
  }
}

function getDirectorySize(rootDir) {
  if (!existsSync(rootDir)) {
    return 0
  }

  let total = 0
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      total += getDirectorySize(entryPath)
      continue
    }

    try {
      total += lstatSync(entryPath).size
    } catch {
      continue
    }
  }

  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value
    .toFixed(value >= 10 ? 1 : 2)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0$/, '$1')} ${units[unitIndex]}`
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  const totalSeconds = durationMs / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1).replace(/\.0$/, '')} s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${minutes}m ${seconds.toFixed(1).replace(/\.0$/, '')}s`
}

function buildYosysRuntimeEnv(bundleRoot) {
  const env = { ...process.env }
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : []
  const runtimeEntries = [join(bundleRoot, 'bin'), join(bundleRoot, 'libexec')].filter((entry) =>
    existsSync(entry),
  )
  env.PATH = [...new Set([...runtimeEntries, ...pathEntries].filter(Boolean))].join(delimiter)
  return env
}

function runWindowsYosysWithEnvironmentBatch(environmentBatch, yosysExecutable, scriptPath, cwd) {
  const wrapperPath = join(cwd, `aspen-yosys-${process.pid}-${Date.now()}.cmd`)
  writeFileSync(
    wrapperPath,
    [
      '@echo off',
      `call "${environmentBatch}"`,
      'if errorlevel 1 exit /b %errorlevel%',
      `"${yosysExecutable}" -s "${scriptPath}"`,
      '',
    ].join('\r\n'),
  )
  try {
    return spawnSync('cmd.exe', ['/d', '/c', wrapperPath], {
      cwd,
      encoding: 'utf8',
    })
  } finally {
    rmSync(wrapperPath, { force: true })
  }
}

function formatSpawnFailure(message, result) {
  const details = []
  if (result.error instanceof Error) {
    details.push(result.error.message)
  }
  if (typeof result.status === 'number') {
    details.push(`exit code ${result.status}`)
  }
  if (result.signal) {
    details.push(`signal ${result.signal}`)
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (output) {
    return `${message}\n${output}`
  }
  if (details.length > 0) {
    return `${message}\n${details.join('\n')}`
  }
  return message
}
