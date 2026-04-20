#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const bundleTargetDir = join(repoRoot, 'src-tauri', 'vendor', 'slang-server')
const releaseRepo = 'hudson-trading/slang-server'
const explicitVersion = process.env.SLANG_SERVER_VERSION?.trim()
const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.SLANG_GITHUB_TOKEN?.trim() || ''

async function main() {
  if (isBundleReady()) {
    console.log(`Bundled slang-server already present at ${bundleTargetDir}.`)
    return
  }

  const { release, asset } = await resolveReleaseAndAsset()
  const downloadDir = join(tmpdir(), `aspen-slang-server-${process.pid}-${Date.now()}`)
  const archivePath = join(downloadDir, asset.name)
  const extractDir = join(downloadDir, 'extract')

  rmSync(downloadDir, { recursive: true, force: true })
  mkdirSync(downloadDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })

  console.log(`Downloading ${asset.name} from ${asset.browser_download_url}`)
  await downloadFile(asset.browser_download_url, archivePath)
  extractArchive(archivePath, extractDir)

  rmSync(bundleTargetDir, { recursive: true, force: true })
  mkdirSync(dirname(bundleTargetDir), { recursive: true })
  cpSync(extractDir, bundleTargetDir, { recursive: true, dereference: true })

  ensureExecutablePermissions()
  validateBundledSlangServer()
  writeReadme(release.tag_name, asset.name)

  rmSync(downloadDir, { recursive: true, force: true })
  console.log(`Bundled slang-server ${release.tag_name} (${asset.name}) into ${bundleTargetDir}.`)
}

function resolveTargetAssetName() {
  const platform = process.env.SLANG_SERVER_PLATFORM?.trim() || process.platform
  const arch = process.env.SLANG_SERVER_ARCH?.trim() || process.arch

  if (platform === 'darwin') {
    return 'slang-server-macos.tar.gz'
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'amd64')) {
    return 'slang-server-linux-x64-gcc.tar.gz'
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'amd64')) {
    return 'slang-server-windows-x64.zip'
  }

  throw new Error(`Unsupported platform '${platform}' / '${arch}' for bundled slang-server.`)
}

async function resolveReleaseAndAsset() {
  if (explicitVersion) {
    const release = await fetchJson(
      `https://api.github.com/repos/${releaseRepo}/releases/tags/${encodeURIComponent(explicitVersion)}`,
      'release metadata',
    )
    if (!release || !Array.isArray(release.assets)) {
      throw new Error('slang-server release metadata did not contain an asset list.')
    }

    return {
      release,
      asset: selectAsset(release.assets),
    }
  }

  const release = await fetchJson(
    `https://api.github.com/repos/${releaseRepo}/releases/latest`,
    'latest release metadata',
  )
  if (!release || !Array.isArray(release.assets)) {
    throw new Error('slang-server latest release metadata did not contain an asset list.')
  }

  return {
    release,
    asset: selectAsset(release.assets),
  }
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      'User-Agent': 'aspen-slang-server-bundler',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch slang-server ${label} (${response.status} ${response.statusText}).`,
    )
  }

  return response.json()
}

function selectAsset(assets) {
  const expectedName = resolveTargetAssetName()
  const asset = assets.find((candidate) => String(candidate.name || '') === expectedName)
  if (!asset) {
    throw new Error(`No slang-server asset matched '${expectedName}' in the selected release.`)
  }
  return asset
}

async function downloadFile(url, destinationPath) {
  if (tryNativeDownload(url, destinationPath)) {
    return
  }

  const response = await fetch(url, {
    headers: {
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      'User-Agent': 'aspen-slang-server-bundler',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download slang-server archive (${response.status}).`)
  }

  if (!response.body) {
    throw new Error('slang-server download response did not include a body.')
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
  const lower = archivePath.toLowerCase()

  if (lower.endsWith('.zip')) {
    const result =
      process.platform === 'win32'
        ? spawnSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${extractDir}" -Force`,
            ],
            { stdio: 'inherit' },
          )
        : spawnSync('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error(`Failed to extract slang-server archive '${archivePath}'.`)
    }
    return
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error(`Failed to extract slang-server archive '${archivePath}'.`)
    }
    return
  }

  throw new Error(`Unsupported slang-server archive format '${archivePath}'.`)
}

function ensureExecutablePermissions() {
  if (process.platform === 'win32') {
    return
  }

  const executable = resolveBundledBinaryPath()
  const result = spawnSync('chmod', ['+x', executable], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Failed to mark bundled slang-server executable '${executable}' as executable.`)
  }
}

function resolveBundledBinaryPath() {
  return join(bundleTargetDir, process.platform === 'win32' ? 'slang-server.exe' : 'slang-server')
}

function isBundleReady() {
  return existsSync(resolveBundledBinaryPath())
}

function validateBundledSlangServer() {
  const executable = resolveBundledBinaryPath()
  if (!existsSync(executable)) {
    throw new Error(`Bundled slang-server executable was not found at ${executable}.`)
  }
}

function writeReadme(version, assetName) {
  writeFileSync(
    join(bundleTargetDir, 'README.md'),
    [
      '# Bundled slang-server',
      '',
      `This directory is managed by \`pnpm prepare:slang-server-bundle\`.`,
      `It currently contains the official \`${assetName}\` asset from slang-server release \`${version}\`.`,
      '',
      'Do not edit the downloaded binaries by hand.',
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)
  console.error(message)
  process.exit(1)
})
