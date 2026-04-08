import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const resourceDir = join(repoRoot, 'src-tauri', 'resource', 'windows-driver')
const helperManifest = join(repoRoot, 'tools', 'aspen-driver-installer', 'Cargo.toml')
const helperBinary = join(
  repoRoot,
  'tools',
  'aspen-driver-installer',
  'target',
  'release',
  'aspen-driver-installer.exe',
)
const bundledHelper = join(resourceDir, 'aspen-driver-installer.exe')
const packageManagerExecutable = process.env.npm_execpath?.trim()

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(
      `Failed to start ${command}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
    )
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function runPackageManager(args) {
  if (packageManagerExecutable) {
    run(process.execPath, [packageManagerExecutable, ...args])
    return
  }

  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args)
}

runPackageManager(['build'])

if (process.platform !== 'win32') {
  process.exit(0)
}

run('cargo', ['build', '--locked', '--manifest-path', helperManifest, '--release'])

mkdirSync(resourceDir, { recursive: true })
copyFileSync(helperBinary, bundledHelper)
