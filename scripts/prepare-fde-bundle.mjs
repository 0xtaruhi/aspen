#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const bundleTargetDir = join(repoRoot, 'src-tauri', 'vendor', 'fde')
const bundledYosysDir = join(repoRoot, 'src-tauri', 'vendor', 'yosys')
const bundledResourceDir = join(repoRoot, 'src-tauri', 'resource', 'fde', 'hw_lib')
const bundledYosysSupportDir = join(repoRoot, 'src-tauri', 'resource', 'yosys-fde')
const upstreamRepoUrl =
  process.env.FDE_SOURCE_REPO?.trim() || 'https://github.com/0xtaruhi/FDE-Source.git'
const preferredSourceDir = process.env.FDE_SOURCE_DIR?.trim()
const buildTargets = ['map', 'pack', 'place', 'route', 'sta', 'bitgen']

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  if (!existsSync(bundledResourceDir)) {
    throw new Error(`Bundled FDE hardware resources were not found at ${bundledResourceDir}.`)
  }

  const sourceRoot = resolveSourceRoot()
  const workingRoot = prepareSourceTree(sourceRoot)
  const buildRoot = join(workingRoot, 'build')
  const bundleBinDir = join(bundleTargetDir, 'bin')
  const bundleLibDir = join(bundleTargetDir, 'lib')

  rmSync(bundleTargetDir, { recursive: true, force: true })
  mkdirSync(bundleBinDir, { recursive: true })
  mkdirSync(bundleLibDir, { recursive: true })

  patchStaExitBug(join(workingRoot, 'source'))
  patchWindowsTargetVersion(join(workingRoot, 'source'))

  const buildEnv = resolveBuildEnvironment()
  configureBuild(join(workingRoot, 'source'), buildRoot, buildEnv)
  buildTargetsInTree(buildRoot, buildEnv)
  copyExecutables(buildRoot, bundleBinDir)
  copyRuntimeDependencies(bundleBinDir, bundleLibDir, buildEnv)
  ensurePlaceholder(bundleTargetDir)
  validateBundledFde(bundleBinDir, bundleLibDir)

  const bundleBytes = getDirectorySize(bundleTargetDir)
  rmSync(workingRoot, { recursive: true, force: true })

  console.log(`Bundled FDE toolchain into ${bundleTargetDir} (${formatBytes(bundleBytes)}).`)
}

function resolveSourceRoot() {
  const candidates = [preferredSourceDir, join(repoRoot, '..', 'FDE-Source')].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, 'CMakeLists.txt'))) {
      return resolve(candidate)
    }
  }

  const cloneRoot = join(tmpdir(), `aspen-fde-source-${process.pid}-${Date.now()}`)
  const cloneResult = spawnSync('git', ['clone', '--depth', '1', upstreamRepoUrl, cloneRoot], {
    stdio: 'inherit',
  })
  if (cloneResult.status !== 0) {
    throw new Error(`Failed to clone FDE-Source from ${upstreamRepoUrl}.`)
  }

  return cloneRoot
}

function prepareSourceTree(sourceRoot) {
  const workingRoot = join(tmpdir(), `aspen-fde-build-${process.pid}-${Date.now()}`)
  const workingSource = join(workingRoot, 'source')
  rmSync(workingRoot, { recursive: true, force: true })
  mkdirSync(workingRoot, { recursive: true })
  cpSync(sourceRoot, workingSource, { recursive: true, dereference: true })
  return workingRoot
}

function patchStaExitBug(sourceRoot) {
  const staAppPath = join(sourceRoot, 'sta', 'sta_app.cpp')
  let source = readFileSync(staAppPath, 'utf8').replace(/\r\n/g, '\n')
  const needle = `STAApp::~STAApp() {\n  if (arg_)\n    delete arg_;\n  if (design_)\n    delete design_;\n  if (engine_)\n    delete engine_;\n}\n`
  const replacement = `STAApp::~STAApp() {\n  arg_ = nullptr;\n  if (design_)\n    delete design_;\n  if (engine_)\n    delete engine_;\n}\n`
  if (source.includes(replacement)) {
    return
  }
  if (!source.includes(needle)) {
    throw new Error(`Unable to patch STA destructor in ${staAppPath}.`)
  }
  source = source.replace(needle, replacement)
  writeFileSync(staAppPath, source)
}

function patchWindowsTargetVersion(sourceRoot) {
  if (process.platform !== 'win32') {
    return
  }

  const rootCmakePath = join(sourceRoot, 'CMakeLists.txt')
  let source = readFileSync(rootCmakePath, 'utf8').replace(/\r\n/g, '\n')
  const marker = 'add_definitions(-D_WIN32_WINNT=0x0602 -DWINVER=0x0602)'
  if (source.includes(marker)) {
    return
  }

  const needle = 'set(CMAKE_CXX_STANDARD 17)\n'
  if (!source.includes(needle)) {
    throw new Error(`Unable to patch Windows target version in ${rootCmakePath}.`)
  }

  const replacement = [
    'set(CMAKE_CXX_STANDARD 17)',
    '',
    'if(WIN32)',
    '\tadd_definitions(-D_WIN32_WINNT=0x0602 -DWINVER=0x0602)',
    'endif()',
    '',
  ].join('\n')

  source = source.replace(needle, replacement)
  writeFileSync(rootCmakePath, source)
}

function resolveBuildEnvironment() {
  const env = { ...process.env }
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : []
  const prefixEntries = env.CMAKE_PREFIX_PATH ? env.CMAKE_PREFIX_PATH.split(delimiter) : []
  const libraryEntries = env.LIBRARY_PATH ? env.LIBRARY_PATH.split(delimiter) : []

  if (process.platform === 'darwin') {
    const brewPrefixes = [
      '/opt/homebrew/opt/boost',
      '/opt/homebrew/opt/bison',
      '/opt/homebrew/opt/flex',
      '/opt/homebrew/opt/icu4c@78',
      '/opt/homebrew/opt/icu4c',
    ].filter((prefix) => existsSync(prefix))

    for (const prefix of brewPrefixes) {
      const binDir = join(prefix, 'bin')
      const libDir = join(prefix, 'lib')
      if (existsSync(binDir)) {
        pathEntries.unshift(binDir)
      }
      prefixEntries.unshift(prefix)
      if (existsSync(libDir)) {
        libraryEntries.unshift(libDir)
      }
    }
  }

  if (process.platform === 'win32') {
    const msysRoot = process.env.MSYS2_ROOT?.trim() || 'C:\\msys64'
    const mingwBin = join(msysRoot, 'mingw64', 'bin')
    const usrBin = join(msysRoot, 'usr', 'bin')
    const mingwPrefix = join(msysRoot, 'mingw64')
    for (const entry of [mingwBin, usrBin]) {
      if (existsSync(entry)) {
        pathEntries.unshift(entry)
      }
    }
    if (existsSync(mingwPrefix)) {
      prefixEntries.unshift(mingwPrefix)
    }
  }

  env.PATH = dedupeEntries(pathEntries).join(delimiter)
  if (prefixEntries.length > 0) {
    env.CMAKE_PREFIX_PATH = dedupeEntries(prefixEntries).join(delimiter)
  }
  if (libraryEntries.length > 0) {
    env.LIBRARY_PATH = dedupeEntries(libraryEntries).join(delimiter)
  }

  return env
}

function configureBuild(sourceRoot, buildRoot, env) {
  mkdirSync(buildRoot, { recursive: true })
  const args = ['-S', sourceRoot, '-B', buildRoot, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']
  const cmakePath = resolveToolPath('cmake', env) || 'cmake'

  if (process.platform === 'win32') {
    const toolArgs = [
      ['CMAKE_C_COMPILER', resolveToolPath('gcc', env)],
      ['CMAKE_CXX_COMPILER', resolveToolPath('g++', env)],
      ['CMAKE_MAKE_PROGRAM', resolveToolPath('ninja', env)],
      ['FLEX_EXECUTABLE', resolveToolPath('flex', env)],
      ['BISON_EXECUTABLE', resolveToolPath('bison', env)],
    ]
    for (const [name, value] of toolArgs) {
      if (value) {
        args.push(`-D${name}=${value}`)
      }
    }
    args.push('-DCMAKE_SH=CMAKE_SH-NOTFOUND')
  }

  const result = spawnSync(cmakePath, args, {
    encoding: 'utf8',
    env,
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0 || result.error) {
    throw new Error(
      formatCmakeFailure('Failed to configure FDE-Source with CMake.', result, {
        buildRoot,
        commandPath: cmakePath,
        args,
        includeConfigureLogs: true,
      }),
    )
  }
}

function buildTargetsInTree(buildRoot, env) {
  const cmakePath = resolveToolPath('cmake', env) || 'cmake'
  const result = spawnSync(cmakePath, ['--build', buildRoot, '--target', ...buildTargets, '-j4'], {
    encoding: 'utf8',
    env,
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0 || result.error) {
    throw new Error(
      formatCmakeFailure('Failed to build the bundled FDE toolchain.', result, {
        buildRoot,
        commandPath: cmakePath,
        args: ['--build', buildRoot, '--target', ...buildTargets, '-j4'],
      }),
    )
  }
}

function copyExecutables(buildRoot, bundleBinDir) {
  const executableNames =
    process.platform === 'win32' ? buildTargets.map((name) => `${name}.exe`) : buildTargets
  const executableRoots = {
    map: join(buildRoot, 'mapping'),
    pack: join(buildRoot, 'packing'),
    place: join(buildRoot, 'placer'),
    route: join(buildRoot, 'router'),
    sta: join(buildRoot, 'sta'),
    bitgen: join(buildRoot, 'bitgen'),
  }

  for (const target of buildTargets) {
    const root = executableRoots[target]
    const executableName = process.platform === 'win32' ? `${target}.exe` : target
    const executablePath = join(root, executableName)
    if (!existsSync(executablePath)) {
      throw new Error(`Built FDE executable not found: ${executablePath}`)
    }
    copyFileSync(executablePath, join(bundleBinDir, executableName))
  }
}

function copyRuntimeDependencies(bundleBinDir, bundleLibDir, runtimeEnv = process.env) {
  const runtimeTargets = readdirSync(bundleBinDir)
    .map((entry) => join(bundleBinDir, entry))
    .filter((entry) => isExecutableTarget(entry))
  const copied = new Set()
  const scanned = new Set()
  const destinationDir = process.platform === 'win32' ? bundleBinDir : bundleLibDir
  const queue = [...runtimeTargets]

  while (queue.length > 0) {
    const target = queue.shift()
    if (!target || scanned.has(target) || !existsSync(target)) {
      continue
    }
    scanned.add(target)

    for (const dependency of collectDependencies(target, runtimeEnv)) {
      if (!existsSync(dependency)) {
        continue
      }

      if (!copied.has(dependency)) {
        copied.add(dependency)
        const destinationPath = join(destinationDir, basename(dependency))
        copyFileSync(dependency, destinationPath)
        queue.push(destinationPath)
      } else if (process.platform === 'win32') {
        queue.push(join(destinationDir, basename(dependency)))
      }
    }
  }
}

function isExecutableTarget(filePath) {
  if (!existsSync(filePath) || lstatSync(filePath).isDirectory()) {
    return false
  }
  if (process.platform === 'win32') {
    return extname(filePath).toLowerCase() === '.exe'
  }
  return extname(filePath) === ''
}

function collectDependencies(filePath, runtimeEnv = process.env) {
  if (process.platform === 'darwin') {
    const result = spawnSync('otool', ['-L', filePath], { encoding: 'utf8' })
    if (result.status !== 0) {
      return []
    }
    return result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(' (')[0])
      .filter((entry) => entry && !entry.startsWith('/usr/lib/') && !entry.startsWith('/System/'))
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
      .filter((entry) => {
        return (
          entry &&
          !entry.startsWith('/lib/') &&
          !entry.startsWith('/lib64/') &&
          !entry.startsWith('/usr/lib/') &&
          !entry.startsWith('/usr/lib64/')
        )
      })
  }

  const result = spawnSync('objdump', ['-p', filePath], { encoding: 'utf8' })
  if (result.status !== 0) {
    return []
  }
  const dllNames = result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/DLL Name:\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
  return dllNames.map((name) => resolveWindowsDependency(name, runtimeEnv)).filter(Boolean)
}

function resolveWindowsDependency(name, runtimeEnv = process.env) {
  const lowerName = String(name).toLowerCase()
  const systemPrefixes = [
    'kernel32.dll',
    'user32.dll',
    'advapi32.dll',
    'shell32.dll',
    'ole32.dll',
    'ws2_32.dll',
    'gdi32.dll',
    'comdlg32.dll',
    'secur32.dll',
    'bcrypt.dll',
    'ntdll.dll',
  ]
  if (systemPrefixes.includes(lowerName)) {
    return null
  }

  const pathEntries = runtimeEnv.PATH?.split(delimiter) ?? []
  for (const entry of pathEntries) {
    const candidate = join(entry, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function ensurePlaceholder(bundleRoot) {
  writeFileSync(
    join(bundleRoot, '.placeholder'),
    'This file keeps the bundled FDE resource directory in git.\n',
  )
}

function validateBundledFde(bundleBinDir, bundleLibDir) {
  if (!existsSync(bundledYosysDir)) {
    throw new Error(
      `Bundled Yosys was not found at ${bundledYosysDir}. Run pnpm prepare:yosys-bundle first.`,
    )
  }

  const validationDir = join(tmpdir(), `aspen-fde-validate-${process.pid}-${Date.now()}`)
  rmSync(validationDir, { recursive: true, force: true })
  mkdirSync(validationDir, { recursive: true })

  const yosysBin =
    process.platform === 'win32'
      ? join(bundledYosysDir, 'bin', 'yosys.exe')
      : join(bundledYosysDir, 'bin', 'yosys')
  const yosysEnv = join(bundledYosysDir, 'environment.bat')
  const fdeSimlib = join(bundledYosysSupportDir, 'fdesimlib.v')
  const fdeCellsMap = join(bundledYosysSupportDir, 'cells_map.v')
  const sourcePath = join(validationDir, 'top.v')
  const constraintPath = join(validationDir, 'top_cons.xml')
  const scriptPath = join(validationDir, 'run.ys')
  const edifPath = join(validationDir, 'top_syn.edf')

  writeFileSync(
    sourcePath,
    [
      'module top(',
      '  input wire sw,',
      '  output wire led',
      ');',
      '  assign led = sw;',
      'endmodule',
      '',
    ].join('\n'),
  )
  writeFileSync(
    constraintPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<design name="top">',
      '  <port name="sw" position="P151"/>',
      '  <port name="led" position="P7"/>',
      '</design>',
      '',
    ].join('\n'),
  )
  writeFileSync(
    scriptPath,
    [
      `read_verilog -lib "${normalizePath(fdeSimlib)}"`,
      `read_verilog -sv "${normalizePath(sourcePath)}"`,
      'hierarchy -check -top top',
      'flatten',
      'synth -run coarse',
      'opt -fast',
      'opt -full',
      'techmap',
      'simplemap',
      'dfflegalize \\',
      '  -cell $_DFF_N_ x \\',
      '  -cell $_DFF_P_ x \\',
      '  -cell $_DFFE_PP_ x \\',
      '  -cell $_DFFE_PN_ x \\',
      '  -cell $_DFF_PN0_ x \\',
      '  -cell $_DFF_PN1_ x \\',
      '  -cell $_DFF_PP0_ x \\',
      '  -cell $_DFF_PP1_ x \\',
      '  -cell $_DFF_NN0_ x \\',
      '  -cell $_DFF_NN1_ x \\',
      '  -cell $_DFF_NP0_ x \\',
      '  -cell $_DFF_NP1_ x',
      `techmap -D NO_LUT -map "${normalizePath(fdeCellsMap)}"`,
      'opt',
      'wreduce',
      'clean',
      'abc -lut 4',
      'opt',
      'wreduce',
      'clean',
      `techmap -map "${normalizePath(fdeCellsMap)}"`,
      'opt',
      'check',
      'stat',
      `write_edif "${normalizePath(edifPath)}"`,
      '',
    ].join('\n'),
  )

  runYosysValidation(yosysBin, yosysEnv, scriptPath, validationDir)

  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'map',
    [
      '-y',
      '-i',
      'top_syn.edf',
      '-o',
      'top_map.xml',
      '-c',
      join(bundledResourceDir, 'dc_cell.xml'),
      '-e',
    ],
    validationDir,
  )
  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'pack',
    [
      '-c',
      'fdp3',
      '-n',
      'top_map.xml',
      '-l',
      join(bundledResourceDir, 'fdp3_cell.xml'),
      '-r',
      join(bundledResourceDir, 'fdp3_dcplib.xml'),
      '-o',
      'top_pack.xml',
      '-g',
      join(bundledResourceDir, 'fdp3_config.xml'),
      '-e',
    ],
    validationDir,
  )
  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'place',
    [
      '-a',
      join(bundledResourceDir, 'fdp3p7_arch.xml'),
      '-d',
      join(bundledResourceDir, 'fdp3p7_dly.xml'),
      '-i',
      'top_pack.xml',
      '-o',
      'top_place.xml',
      '-c',
      'top_cons.xml',
      '-t',
      '-e',
    ],
    validationDir,
  )
  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'route',
    [
      '-a',
      join(bundledResourceDir, 'fdp3p7_arch.xml'),
      '-n',
      'top_place.xml',
      '-o',
      'top_route.xml',
      '-t',
      '-c',
      'top_cons.xml',
      '-e',
    ],
    validationDir,
  )
  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'sta',
    [
      '-a',
      join(bundledResourceDir, 'fdp3p7_arch.xml'),
      '-i',
      'top_route.xml',
      '-l',
      join(bundledResourceDir, 'fdp3_con.xml'),
      '-o',
      'top_sta.xml',
      '-r',
      'top_sta.rpt',
      '-e',
    ],
    validationDir,
  )
  runFdeValidationStage(
    bundleBinDir,
    bundleLibDir,
    'bitgen',
    [
      '-a',
      join(bundledResourceDir, 'fdp3p7_arch.xml'),
      '-c',
      join(bundledResourceDir, 'fdp3p7_cil.xml'),
      '-n',
      'top_route.xml',
      '-b',
      'top.bit',
      '-e',
    ],
    validationDir,
  )

  if (!existsSync(join(validationDir, 'top.bit'))) {
    throw new Error('Bundled FDE validation did not produce a bitstream.')
  }

  rmSync(validationDir, { recursive: true, force: true })
}

function runYosysValidation(yosysBin, yosysEnv, scriptPath, cwd) {
  const result =
    process.platform === 'win32' && existsSync(yosysEnv)
      ? runWindowsYosysWithEnvironmentBatch(yosysEnv, yosysBin, scriptPath, cwd)
      : spawnSync(yosysBin, ['-s', scriptPath], {
          cwd,
          encoding: 'utf8',
          env: buildYosysRuntimeEnv(bundledYosysDir),
        })

  if (result.status !== 0) {
    throw new Error(formatSpawnFailure('Bundled FDE validation failed during Yosys.', result))
  }
}

function runFdeValidationStage(bundleBinDir, bundleLibDir, stage, args, cwd) {
  const executableName = process.platform === 'win32' ? `${stage}.exe` : stage
  const executablePath = join(bundleBinDir, executableName)
  const env = buildFdeRuntimeEnv(bundleBinDir, bundleLibDir)
  const result = spawnSync(executablePath, args, {
    cwd,
    encoding: 'utf8',
    env,
  })
  if (result.status !== 0 || result.error) {
    throw new Error(
      formatFdeValidationFailure(`Bundled FDE validation failed during ${stage}.`, result, {
        executablePath,
        args,
        cwd,
        bundleBinDir,
      }),
    )
  }
}

function buildFdeRuntimeEnv(bundleBinDir, bundleLibDir) {
  const env = { ...process.env }
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : []
  pathEntries.unshift(bundleBinDir)
  env.PATH = dedupeEntries(pathEntries).join(delimiter)

  if (process.platform === 'darwin') {
    const dyldEntries = env.DYLD_LIBRARY_PATH ? env.DYLD_LIBRARY_PATH.split(':') : []
    dyldEntries.unshift(bundleLibDir)
    env.DYLD_LIBRARY_PATH = dedupeEntries(dyldEntries).join(':')
  } else if (process.platform === 'linux') {
    const ldEntries = env.LD_LIBRARY_PATH ? env.LD_LIBRARY_PATH.split(':') : []
    ldEntries.unshift(bundleLibDir)
    env.LD_LIBRARY_PATH = dedupeEntries(ldEntries).join(':')
  }

  return env
}

function buildYosysRuntimeEnv(bundleRoot) {
  const env = { ...process.env }
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : []
  const runtimeEntries = [join(bundleRoot, 'bin'), join(bundleRoot, 'libexec')].filter((entry) =>
    existsSync(entry),
  )
  env.PATH = dedupeEntries([...runtimeEntries, ...pathEntries]).join(delimiter)
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

function formatCmakeFailure(message, result, options) {
  const { buildRoot, commandPath, args, includeConfigureLogs = false } = options
  const sections = [formatSpawnFailure(message, result), `Build directory: ${buildRoot}`]

  if (commandPath) {
    sections.push(`Command: ${commandPath}`)
  }
  if (Array.isArray(args) && args.length > 0) {
    sections.push(`Args: ${args.join(' ')}`)
  }

  if (includeConfigureLogs) {
    const cmakeFilesDir = join(buildRoot, 'CMakeFiles')
    const logFiles = [
      ['CMakeError.log', join(cmakeFilesDir, 'CMakeError.log')],
      ['CMakeOutput.log', join(cmakeFilesDir, 'CMakeOutput.log')],
    ]

    for (const [label, filePath] of logFiles) {
      if (!existsSync(filePath)) {
        continue
      }

      const contents = readFileSync(filePath, 'utf8').trim()
      if (!contents) {
        continue
      }

      sections.push(`${label} (${filePath})\n${tailLines(contents, 200)}`)
    }
  }

  return sections.join('\n\n')
}

function formatFdeValidationFailure(message, result, options) {
  const { executablePath, args, cwd, bundleBinDir } = options
  const sections = [formatSpawnFailure(message, result)]

  if (executablePath) {
    sections.push(`Executable: ${executablePath}`)
  }
  if (Array.isArray(args) && args.length > 0) {
    sections.push(`Args: ${args.join(' ')}`)
  }
  if (cwd) {
    sections.push(`Working directory: ${cwd}`)
  }

  if (process.platform === 'win32' && bundleBinDir && existsSync(bundleBinDir)) {
    const bundledEntries = readdirSync(bundleBinDir).sort()
    sections.push(`Bundled bin contents: ${bundledEntries.join(', ')}`)
  }

  return sections.join('\n\n')
}

function tailLines(text, lineCount) {
  const lines = text.split(/\r?\n/)
  return lines.slice(-lineCount).join('\n')
}

function normalizePath(path) {
  return resolve(path).replaceAll('\\', '/')
}

function resolveToolPath(name, env) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : []

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

function dedupeEntries(entries) {
  return [...new Set(entries.filter(Boolean))]
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

    total += lstatSync(entryPath).size
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
