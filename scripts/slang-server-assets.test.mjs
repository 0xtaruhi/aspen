import { describe, expect, it } from 'vitest'

import { resolveTargetAssetName } from './prepare-slang-server-bundle.mjs'

describe('slang-server release assets', () => {
  it('uses the glibc-compatible Linux x64 build', () => {
    expect(resolveTargetAssetName('linux', 'x64')).toBe('slang-server-old-linux-x64-gcc.tar.gz')
  })
})
