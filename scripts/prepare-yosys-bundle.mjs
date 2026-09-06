#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parsePortableExecutableDependencyNames } from './lib/portable-executable.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(repoRoot, 'third_party', 'yosys')
const bundleDir = join(repoRoot, 'src-tauri', 'vendor', 'yosys')
const manifestName = 'aspen-build.json'
const exeSuffix = process.platform === 'win32' ? '.exe' : ''

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
    shell: false,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`,
    )
  }
  return result.stdout?.trim() || ''
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function walk(root, prefix = '', strict = true) {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return []
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) return walk(root, name, strict)
    if (!entry.isFile() && !strict) return []
    if (!entry.isFile()) throw new Error(`Unexpected non-regular file: ${join(root, name)}`)
    return [name]
  })
}

export function fileInventory(root) {
  return Object.fromEntries(
    walk(root)
      .filter((name) => name !== manifestName && name !== '.placeholder')
      .sort()
      .map((name) => [name, hash(readFileSync(join(root, name)))]),
  )
}

export function bundleMatches(root, expected, buildKey, packaged = false) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, manifestName), 'utf8'))
    const files = fileInventory(root)
    return (
      Object.entries(expected).every(([key, value]) => manifest[key] === value) &&
      (!buildKey || manifest.buildKey === buildKey) &&
      JSON.stringify(Object.keys(manifest.files)) === JSON.stringify(Object.keys(files)) &&
      Object.entries(files).every(
        ([name, digest]) =>
          // Signing changes executable bytes; packaged apps have a separate signature check.
          (packaged && name.startsWith('bin/')) || manifest.files[name] === digest,
      )
    )
  } catch {
    return false
  }
}

function expectedManifest() {
  const sourceCommit = existsSync(join(sourceDir, 'CMakeLists.txt'))
    ? run('git', ['rev-parse', 'HEAD'], { cwd: sourceDir })
    : run('git', ['rev-parse', ':third_party/yosys'])
  return {
    schema: 1,
    sourceCommit,
    recipe: hash(
      Buffer.concat([
        readFileSync(fileURLToPath(import.meta.url)),
        readFileSync(join(repoRoot, 'scripts', 'lib', 'portable-executable.mjs')),
      ]),
    ),
    platform: process.platform,
    arch: process.arch,
  }
}

function toolPath(name) {
  const suffixes = process.platform === 'win32' ? ['', '.exe'] : ['']
  const candidates = [name, ...(process.env.PATH || '').split(delimiter).map((p) => join(p, name))]
  for (const candidate of candidates) {
    for (const suffix of suffixes) {
      if (existsSync(candidate + suffix)) return resolve(candidate + suffix)
    }
  }
  throw new Error(`Missing build tool '${name}'. See README.md for Yosys build prerequisites.`)
}

function buildConfiguration() {
  const cmake = toolPath('cmake')
  const ninja = toolPath('ninja')
  const cc = toolPath(process.env.CC || (process.platform === 'linux' ? 'gcc' : 'clang'))
  const cxx = toolPath(process.env.CXX || (process.platform === 'linux' ? 'g++' : 'clang++'))
  const compilerVersion = run(cxx, ['--version'])
  if (process.platform === 'win32' && !run(cxx, ['-dumpmachine']).includes('windows-gnu')) {
    throw new Error(
      'Windows builds require MSYS2 CLANG64 clang/clang++; put clang64/bin first in PATH.',
    )
  }
  const options = {
    CMAKE_BUILD_TYPE: 'Release',
    CMAKE_C_COMPILER: cc,
    CMAKE_CXX_COMPILER: cxx,
    CMAKE_MAKE_PROGRAM: ninja,
    BUILD_SHARED_LIBS: 'OFF',
    YOSYS_INSTALL_LIBRARY: 'OFF',
    YOSYS_USE_BUNDLED_LIBS: 'ON',
    YOSYS_WITHOUT_SLANG: 'ON',
    YOSYS_WITHOUT_TCL: 'ON',
    YOSYS_WITHOUT_READLINE: 'ON',
    YOSYS_WITHOUT_EDITLINE: 'ON',
    YOSYS_WITHOUT_LIBFFI: 'ON',
    YOSYS_WITHOUT_ZLIB: 'ON',
    YOSYS_WITH_PYTHON: 'OFF',
  }
  if (process.platform === 'darwin') {
    options.CMAKE_OSX_DEPLOYMENT_TARGET = process.env.MACOSX_DEPLOYMENT_TARGET || '12.0'
    options.CMAKE_OSX_ARCHITECTURES = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  }
  if (process.platform === 'linux') {
    options.CMAKE_EXE_LINKER_FLAGS =
      `${process.env.LDFLAGS || ''} -static-libstdc++ -static-libgcc`.trim()
  }
  const environment = Object.fromEntries(
    ['CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'SDKROOT', 'CMAKE_PREFIX_PATH', 'PKG_CONFIG_PATH'].map(
      (key) => [key, process.env[key] || ''],
    ),
  )
  return {
    cmake,
    cc,
    options,
    identity: {
      options,
      environment,
      compilerVersion,
      cVersion: run(cc, ['--version']),
      cmake: run(cmake, ['--version']),
      ninja: run(ninja, ['--version']),
      sourceDir,
    },
  }
}

// Only Windows OS libraries may be satisfied by the host. Compiler runtime DLLs
// must be copied even when a developer happens to have them in System32.
export function isWindowsSystemDll(name) {
  return (
    /^(api-ms-win-|ext-ms-win-)/i.test(name) ||
    new Set([
      'advapi32.dll',
      'bcrypt.dll',
      'comdlg32.dll',
      'crypt32.dll',
      'dbghelp.dll',
      'gdi32.dll',
      'imm32.dll',
      'kernel32.dll',
      'msvcrt.dll',
      'ntdll.dll',
      'ole32.dll',
      'oleaut32.dll',
      'psapi.dll',
      'rpcrt4.dll',
      'secur32.dll',
      'setupapi.dll',
      'shell32.dll',
      'shlwapi.dll',
      'ucrtbase.dll',
      'user32.dll',
      'userenv.dll',
      'version.dll',
      'winmm.dll',
      'ws2_32.dll',
    ]).has(name.toLowerCase())
  )
}

function collectWindowsRuntime(root, compiler) {
  const bin = join(root, 'bin')
  const searchDirs = [bin, dirname(compiler)]
  const queue = readdirSync(bin).filter((name) => /\.(exe|dll)$/i.test(name))
  const seen = new Set()
  while (queue.length) {
    const name = queue.pop()
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    for (const dependency of parsePortableExecutableDependencyNames(
      readFileSync(join(bin, name)),
    )) {
      if (isWindowsSystemDll(dependency)) continue
      let found
      for (const directory of searchDirs) {
        const actual = readdirSync(directory).find(
          (file) => file.toLowerCase() === dependency.toLowerCase(),
        )
        if (actual) {
          found = join(directory, actual)
          break
        }
      }
      if (!found) throw new Error(`Unresolved runtime DLL ${dependency} required by ${name}`)
      if (dirname(found) !== bin) cpSync(found, join(bin, dependency))
      queue.push(dependency)
    }
  }
  // MSYS2 ships the redistribution notices for its compiler/runtime packages here.
  const licenses = resolve(dirname(compiler), '..', 'share', 'licenses')
  if (!existsSync(licenses)) throw new Error(`Missing MSYS2 runtime licenses at ${licenses}`)
  cpSync(licenses, join(root, 'license', 'msys2'), { recursive: true, dereference: true })
}

function checkRuntimeDependencies(root) {
  const bin = join(root, 'bin')
  for (const name of readdirSync(bin)) {
    const binary = join(bin, name)
    if (process.platform === 'darwin') {
      const dependencies = run('otool', ['-L', binary]).split('\n').slice(1)
      for (const line of dependencies) {
        const dependency = line.trim().split(' (')[0]
        if (!dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/')) {
          throw new Error(`${name} depends on a non-system library: ${dependency}`)
        }
      }
    } else if (process.platform === 'linux') {
      const dependencies = run('ldd', [binary])
      if (/not found/.test(dependencies)) throw new Error(`Unresolved dependency: ${dependencies}`)
      for (const line of dependencies.split('\n')) {
        const dependency = line.trim().split(/\s/)[0]
        if (!/^(linux-vdso|ld-linux|\/.*\/ld-linux|lib(c|m|dl|pthread|rt)\.so)/.test(dependency)) {
          throw new Error(`${name} depends on an unbundled library: ${dependency}`)
        }
      }
    } else if (process.platform === 'win32') {
      for (const dependency of parsePortableExecutableDependencyNames(readFileSync(binary))) {
        if (
          !isWindowsSystemDll(dependency) &&
          !readdirSync(bin).some((file) => file.toLowerCase() === dependency.toLowerCase())
        ) {
          throw new Error(`Missing bundled DLL ${dependency} required by ${name}`)
        }
      }
    }
  }
}

function validateBundle(root) {
  for (const name of [
    `bin/yosys${exeSuffix}`,
    `bin/yosys-abc${exeSuffix}`,
    'share/yosys/techlibs/common/techmap.v',
  ]) {
    // Older layouts put common technology files directly under share/yosys.
    if (
      !existsSync(join(root, name)) &&
      !(name.startsWith('share/') && existsSync(join(root, 'share/yosys/techmap.v')))
    ) {
      throw new Error(`Incomplete Yosys installation: missing ${name}`)
    }
  }
  checkRuntimeDependencies(root)
  const temporary = mkdtempSync(join(tmpdir(), 'aspen-yosys-check-'))
  try {
    const relocated = join(temporary, 'toolchain moved 测试')
    cpSync(root, relocated, { recursive: true })
    const work = join(temporary, 'project 测试')
    mkdirSync(work)
    writeFileSync(
      join(work, 'top.v'),
      'module top(input clk, input [3:0] a, b, output reg [3:0] q); always @(posedge clk) q <= (a + b) ^ (a & b); endmodule\n',
    )
    writeFileSync(
      join(work, 'run.ys'),
      'read_verilog -sv top.v\nhierarchy -check -top top\nsynth -top top -lut 4\ncheck -assert\nwrite_edif netlist.edf\nwrite_json netlist.json\n',
    )
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (/^(PATH|LD_LIBRARY_PATH|DYLD_.*|YOSYS_.*|ABC|TCL_LIBRARY|TK_LIBRARY)$/i.test(key))
        delete env[key]
    }
    env.PATH =
      process.platform === 'win32'
        ? [join(relocated, 'bin'), join(process.env.SystemRoot || 'C:\\Windows', 'System32')].join(
            delimiter,
          )
        : '/usr/bin:/bin'
    const yosys = join(relocated, 'bin', `yosys${exeSuffix}`)
    const version = run(yosys, ['-V'], { cwd: work, env })
    const log = run(yosys, ['-s', 'run.ys'], { cwd: work, env })
    const netlist = JSON.parse(readFileSync(join(work, 'netlist.json'), 'utf8'))
    if (
      !Object.values(netlist.modules.top.cells).some((cell) => cell.type === '$lut') ||
      !log.includes('ABC RESULTS') ||
      !readFileSync(join(work, 'netlist.edf'), 'utf8').includes('(edif')
    ) {
      throw new Error('Relocated Yosys did not complete ABC LUT mapping and EDIF export.')
    }
    console.log(`Validated ${version}, including relocated ABC synthesis and Unicode paths.`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function installLicenses(root) {
  for (const file of walk(sourceDir, '', false).filter((name) =>
    /(^|\/)(copying|copyright|licen[cs]e)([.-]|$)/i.test(name),
  )) {
    const target = join(root, 'license', file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(sourceDir, file), target)
  }
  // These small vendored libraries carry their notices in source files.
  for (const library of ['bigint', 'ezsat', 'fst', 'json11', 'sha1', 'subcircuit', 'dlfcn-win32']) {
    cpSync(join(sourceDir, 'libs', library), join(root, 'license', 'source-notices', library), {
      recursive: true,
    })
  }
}

export function publishBundle(installation, target = bundleDir) {
  mkdirSync(dirname(target), { recursive: true })
  const staging = mkdtempSync(join(dirname(target), '.yosys-stage-'))
  const backup = `${staging}-previous`
  let published = false
  try {
    cpSync(installation, staging, { recursive: true })
    if (existsSync(target)) renameSync(target, backup)
    try {
      renameSync(staging, target)
      published = true
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, target)
      throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    if (published) rmSync(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Usage: pnpm prepare:yosys-bundle [--force | --check [bundle-directory]]\nBuild the pinned third_party/yosys Git submodule with CMake, or validate an existing bundle.\nUse --check-packaged <directory> after app signing.\nOptional: ASPEN_YOSYS_CACHE_DIR, CMAKE_BUILD_PARALLEL_LEVEL, CC, CXX. See README.md for upgrading Yosys.',
    )
    return
  }
  if (['--check', '--check-packaged'].includes(args[0]) && args.length <= 2) {
    const root = args[1] ? resolve(args[1]) : bundleDir
    if (!bundleMatches(root, expectedManifest(), undefined, args[0] === '--check-packaged'))
      throw new Error(`Missing, stale, or damaged Yosys bundle: ${root}`)
    validateBundle(root)
    return
  }
  if (args.length && !(args.length === 1 && args[0] === '--force'))
    throw new Error('Unknown arguments. Use --help.')
  if (
    !['darwin', 'linux', 'win32'].includes(process.platform) ||
    !['x64', 'arm64'].includes(process.arch) ||
    (process.platform === 'win32' && process.arch !== 'x64')
  ) {
    throw new Error(`Unsupported native Yosys build: ${process.platform}/${process.arch}`)
  }
  if (!existsSync(join(sourceDir, 'CMakeLists.txt'))) {
    run(
      'git',
      ['submodule', 'update', '--init', '--recursive', '--depth', '1', '--', 'third_party/yosys'],
      { stdio: 'inherit' },
    )
  }
  if (
    run('git', ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], {
      cwd: sourceDir,
    })
  ) {
    throw new Error(
      'Yosys source or its submodules have tracked changes. Commit or restore them before building.',
    )
  }
  run(
    'git',
    ['submodule', 'foreach', '--recursive', 'git diff --quiet --ignore-submodules=all HEAD'],
    { cwd: sourceDir },
  )
  run('git', ['submodule', 'update', '--init', '--recursive', '--depth', '1'], {
    cwd: sourceDir,
    stdio: 'inherit',
  })
  const expected = expectedManifest()
  const config = buildConfiguration()
  const buildKey = hash(
    JSON.stringify({
      sourceCommit: expected.sourceCommit,
      platform: expected.platform,
      arch: expected.arch,
      ...config.identity,
    }),
  )
  if (!args.includes('--force') && bundleMatches(bundleDir, expected, buildKey)) {
    validateBundle(bundleDir)
    console.log('Reusing the verified bundled Yosys; no download or compilation needed.')
    return
  }
  const cacheRoot = resolve(
    process.env.ASPEN_YOSYS_CACHE_DIR || join(repoRoot, 'src-tauri', 'target', 'yosys'),
  )
  const cache = join(cacheRoot, buildKey)
  const installation = join(cache, 'install')
  mkdirSync(cacheRoot, { recursive: true })
  const lock = join(cacheRoot, 'prepare.lock')
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(
      `Another Yosys preparation may be running (${lock}). If it was interrupted, remove this lock directory and retry.`,
      { cause: error },
    )
  }
  try {
    if (args.includes('--force')) rmSync(cache, { recursive: true, force: true })
    if (!bundleMatches(installation, expected, buildKey)) {
      const build = join(cache, 'build')
      mkdirSync(build, { recursive: true })
      console.log(`Building Yosys ${expected.sourceCommit} from ${sourceDir}`)
      run(
        config.cmake,
        [
          '-S',
          sourceDir,
          '-B',
          build,
          '-G',
          'Ninja',
          `-DCMAKE_INSTALL_PREFIX=${installation}`,
          ...Object.entries(config.options).map(([key, value]) => `-D${key}=${value}`),
        ],
        { stdio: 'inherit' },
      )
      const jobs =
        process.env.CMAKE_BUILD_PARALLEL_LEVEL || String(Math.min(availableParallelism(), 8))
      if (!/^[1-9]\d*$/.test(jobs))
        throw new Error('CMAKE_BUILD_PARALLEL_LEVEL must be a positive integer.')
      // Upstream's default all target also builds optional host GTest executables.
      run(
        config.cmake,
        ['--build', build, '--target', 'yosys', 'yosys-abc', 'yosys-filterlib', '--parallel', jobs],
        { stdio: 'inherit' },
      )
      rmSync(installation, { recursive: true, force: true })
      run(config.cmake, ['--install', build, '--config', 'Release'], { stdio: 'inherit' })
      for (const name of readdirSync(join(installation, 'bin'))) {
        if (
          ![`yosys${exeSuffix}`, `yosys-abc${exeSuffix}`].includes(name) &&
          !name.endsWith('.dll')
        )
          rmSync(join(installation, 'bin', name), { recursive: true, force: true })
      }
      installLicenses(installation)
      if (process.platform === 'win32') collectWindowsRuntime(installation, config.cc)
      writeFileSync(
        join(installation, '.placeholder'),
        'This file keeps the bundled Yosys resource directory in git.\n',
      )
      validateBundle(installation)
      writeFileSync(
        join(installation, manifestName),
        `${JSON.stringify({ ...expected, buildKey, toolchain: config.identity, files: fileInventory(installation) }, null, 2)}\n`,
      )
    } else {
      validateBundle(installation)
      console.log('Restoring Yosys from the local build cache.')
    }
    publishBundle(installation)
    console.log(`Prepared source-built Yosys in ${bundleDir}`)
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
