import { beforeEach, describe, expect, it, vi } from 'vitest'

function flushMicrotasks() {
  return Promise.resolve()
}

describe('native menu language sync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('coalesces rapid language changes and keeps the latest language', async () => {
    let resolveFirstInvoke: (() => void) | undefined
    let resolveSecondInvoke: (() => void) | undefined

    const invoke = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstInvoke = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecondInvoke = resolve
          }),
      )

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke,
      isTauri: () => true,
    }))

    const { syncNativeMenuLanguage } = await import('./native-language')

    const firstSync = syncNativeMenuLanguage('zh-CN')
    const secondSync = syncNativeMenuLanguage('en-US')

    await flushMicrotasks()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenNthCalledWith(1, 'app_set_menu_language', {
      language: 'zh-CN',
    })

    resolveFirstInvoke?.()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenNthCalledWith(2, 'app_set_menu_language', {
      language: 'en-US',
    })

    resolveSecondInvoke?.()
    await Promise.all([firstSync, secondSync])

    await syncNativeMenuLanguage('en-US')

    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
