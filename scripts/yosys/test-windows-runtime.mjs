// Exercise the real CMake manifest hook before the much larger Yosys build.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('This native runtime probe requires Windows.')
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'aspen-utf8-probe-'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`,
    )
  }
  if (result.stdout) process.stdout.write(result.stdout)
}

try {
  const source = join(temporary, 'source')
  const build = join(temporary, 'build')
  const work = join(temporary, 'project 测试')
  const binaries = join(temporary, 'toolchain moved 测试')
  mkdirSync(source)
  mkdirSync(work)
  writeFileSync(join(work, '文件.v'), 'module top; endmodule\n')
  writeFileSync(
    join(source, 'CMakeLists.txt'),
    `
cmake_minimum_required(VERSION 3.28)
project(yosys LANGUAGES C)
add_executable(yosys probe.c)
add_executable(yosys-abc probe.c)
`,
  )
  writeFileSync(
    join(source, 'probe.c'),
    `
#include <windows.h>
#include <stdio.h>

int main(void) {
  char path[MAX_PATH + 1];
  char short_path[MAX_PATH + 1];
  printf("Process code page: %u\\n", GetACP());
  if (GetACP() != CP_UTF8) return 1;
  if (!GetModuleFileNameA(NULL, path, sizeof(path))) return 2;
  if (!GetShortPathNameA(path, short_path, sizeof(short_path))) return 3;
  if (!GetTempPathA(sizeof(path), path)) return 4;
  if (!GetShortPathNameA(path, short_path, sizeof(short_path))) return 5;
  FILE *source = fopen("\\xE6\\x96\\x87\\xE4\\xBB\\xB6.v", "r");
  if (!source) return 6;
  fclose(source);
  return 0;
}
`,
  )
  run('cmake', [
    '-S',
    source,
    '-B',
    build,
    '-G',
    'Ninja',
    `-DCMAKE_C_COMPILER=${process.env.CC || 'gcc'}`,
    `-DCMAKE_PROJECT_yosys_INCLUDE=${resolve(scriptsDir, 'windows-runtime.cmake')}`,
    `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${binaries}`,
  ])
  run('cmake', ['--build', build])
  // Both the executable path and the temp directory exercise the ANSI APIs in Yosys.
  const env = { ...process.env, TMP: work, TEMP: work }
  for (const executable of ['yosys.exe', 'yosys-abc.exe']) {
    run(join(binaries, executable), [], { cwd: work, env })
  }
  console.log('Both runtime manifests passed Unicode installation, temp, and source paths.')
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
