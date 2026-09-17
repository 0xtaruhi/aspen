import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const fixtures = []
const reload = 'control --reload-rules --timeout=5'
const trigger =
  'trigger --action=change --subsystem-match=usb --attr-match=idVendor=2200 --attr-match=idProduct=2008'

function fixture({ missingUdev = false, fail = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aspen-package-hooks-'))
  fixtures.push(root)
  const log = join(root, 'udev.log')
  if (!missingUdev) {
    writeFileSync(
      join(root, 'udevadm'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$ASPEN_UDEV_LOG"
if [ "$1" = "$ASPEN_UDEV_FAIL" ]; then exit 1; fi
`,
      { mode: 0o755 },
    )
  }
  return {
    run(script, ...args) {
      return spawnSync(
        '/bin/sh',
        [fileURLToPath(new URL(`../src-tauri/linux/${script}.sh`, import.meta.url)), ...args],
        {
          encoding: 'utf8',
          // Never call the host's udevadm while testing privileged package hooks.
          env: { ...process.env, PATH: root, ASPEN_UDEV_LOG: log, ASPEN_UDEV_FAIL: fail },
        },
      )
    },
    calls() {
      return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
    },
  }
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('Linux package hooks', () => {
  it.each([['configure'], ['configure', '0.6.2'], ['1'], ['2']])(
    'refreshes only VLFD boards on install/upgrade with argument %s',
    (...args) => {
      const host = fixture()
      expect(host.run('post-install', ...args).status).toBe(0)
      expect(host.calls()).toEqual([reload, trigger])
      expect(host.run('post-install', ...args).status).toBe(0)
      expect(host.calls()).toEqual([reload, trigger, reload, trigger])
    },
  )

  it('does not refresh hardware during a Debian abort callback', () => {
    const host = fixture()
    expect(host.run('post-install', 'abort-upgrade', '0.6.3').status).toBe(0)
    expect(host.calls()).toEqual([])
  })

  it('allows offline installation when udevadm is unavailable', () => {
    const host = fixture({ missingUdev: true })
    const result = host.run('post-install', 'configure')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('udevadm is unavailable')
  })

  it('does not trigger devices when the udev daemon cannot reload rules', () => {
    const host = fixture({ fail: 'control' })
    const result = host.run('post-install', '1')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('could not reload udev rules')
    expect(host.calls()).toEqual([reload])
  })

  it('reports a failed permission refresh without breaking package installation', () => {
    const host = fixture({ fail: 'trigger' })
    const result = host.run('post-install', 'configure')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('unplug and reconnect')
    expect(host.calls()).toEqual([reload, trigger])
  })

  it.each(['remove', 'purge', 'disappear', '0'])('reloads rules after %s', (action) => {
    const host = fixture()
    expect(host.run('post-remove', action).status).toBe(0)
    expect(host.calls()).toEqual([reload])
  })

  it.each(['upgrade', '1', 'abort-install'])('skips removal callback %s', (action) => {
    const host = fixture()
    expect(host.run('post-remove', action).status).toBe(0)
    expect(host.calls()).toEqual([])
  })

  it('allows removal without a running udev daemon', () => {
    const host = fixture({ fail: 'control' })
    const result = host.run('post-remove', '0')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('could not reload udev rules after removal')
  })

  it('allows removal when udevadm is unavailable', () => {
    const host = fixture({ missingUdev: true })
    expect(host.run('post-remove', 'remove').status).toBe(0)
  })
})
