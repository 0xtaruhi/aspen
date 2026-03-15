#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
  await downloadFile(asset.browser_download_url, archivePath)
  extractArchive(archivePath, extractDir)

  const extractedRoot = findToolchainRoot(extractDir)
  rmSync(bundleTargetDir, { recursive: true, force: true })
  mkdirSync(dirname(bundleTargetDir), { recursive: true })
  cpSync(extractedRoot, bundleTargetDir, { recursive: true, dereference: true })
  materializeBundledSymlinks(bundleTargetDir)
  pruneBundledToolchain(bundleTargetDir)
  ensureBundlePlaceholder(bundleTargetDir)
  validateBundledYosys(bundleTargetDir)
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
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Invoke-WebRequest -Uri "${url}" -OutFile "${destinationPath}"`],
      { stdio: 'inherit' },
    )
    return result.status === 0
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
  pruneChildren(
    bundleRoot,
    new Set(['README', 'VERSION', 'bin', 'lib', 'libexec', 'license', 'share']),
  )
  pruneBinDirectory(join(bundleRoot, 'bin'))
  pruneLibexecDirectory(join(bundleRoot, 'libexec'))
  pruneShareDirectory(join(bundleRoot, 'share'))
  pruneLibraryDirectories(bundleRoot)
}

function pruneBinDirectory(binDir) {
  if (!existsSync(binDir)) {
    return
  }

  const keep = new Set(['yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  for (const entry of readdirSync(binDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEntry(join(binDir, entry.name))
      continue
    }

    const lowerName = entry.name.toLowerCase()
    if (keep.has(entry.name) || lowerName.endsWith('.dll')) {
      continue
    }

    removeEntry(join(binDir, entry.name))
  }
}

function pruneLibexecDirectory(libexecDir) {
  if (!existsSync(libexecDir)) {
    return
  }

  const keep = new Set(['realpath', 'yosys', 'yosys-abc', 'yosys.exe', 'yosys-abc.exe'])
  for (const entry of readdirSync(libexecDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEntry(join(libexecDir, entry.name))
      continue
    }

    const lowerName = entry.name.toLowerCase()
    if (keep.has(entry.name) || lowerName.endsWith('.dll')) {
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

function pruneLibraryDirectories(bundleRoot) {
  const runtimeTargets = getRuntimeTargetPaths(bundleRoot)
  const dependencyPaths = collectBundledDependencies(bundleRoot, runtimeTargets)
  const keepLibEntries = new Set(
    ['tcl8.6', 'tk8.6'].filter((entry) => existsSync(join(bundleRoot, 'lib', entry))),
  )
  const keepFrameworkEntries = new Set()

  for (const dependencyPath of dependencyPaths) {
    const relPath = relative(bundleRoot, dependencyPath)
    if (relPath.startsWith(`lib/`)) {
      const [, firstChild] = relPath.split(/[\\/]/, 2)
      if (firstChild) {
        keepLibEntries.add(firstChild)
      }
    }
    if (relPath.startsWith(`Frameworks/`)) {
      const [, firstChild] = relPath.split(/[\\/]/, 2)
      if (firstChild) {
        keepFrameworkEntries.add(firstChild)
      }
    }
  }

  const libDir = join(bundleRoot, 'lib')
  if (existsSync(libDir)) {
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (keepLibEntries.has(entry.name)) {
        continue
      }
      removeEntry(join(libDir, entry.name))
    }
  }

  const frameworksDir = join(bundleRoot, 'Frameworks')
  if (existsSync(frameworksDir)) {
    if (keepFrameworkEntries.size === 0) {
      removeEntry(frameworksDir)
      return
    }

    for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
      if (keepFrameworkEntries.has(entry.name)) {
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
    join(bundleRoot, 'libexec', 'yosys'),
    join(bundleRoot, 'libexec', 'yosys-abc'),
    join(bundleRoot, 'libexec', 'realpath'),
    join(bundleRoot, 'bin', 'yosys.exe'),
    join(bundleRoot, 'bin', 'yosys-abc.exe'),
    join(bundleRoot, 'bin', 'yosys'),
    join(bundleRoot, 'bin', 'yosys-abc'),
  ]

  return candidates.filter((candidate) => existsSync(candidate) && !isShellScript(candidate))
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

  return []
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

  const result = spawnSync(yosysExecutable, ['-s', scriptPath], {
    cwd: validationDir,
    encoding: 'utf8',
  })
  rmSync(validationDir, { recursive: true, force: true })

  if (result.status !== 0) {
    throw new Error(
      `Bundled Yosys validation failed.\n${result.stdout || ''}${result.stderr || ''}`.trim(),
    )
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
