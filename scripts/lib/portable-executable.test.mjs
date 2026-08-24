import { describe, expect, it } from 'vitest'

import { parsePortableExecutableDependencyNames } from './portable-executable.mjs'

function buildPortableExecutable({ magic = 0x10b, imports = [], delayImports = [] } = {}) {
  const peHeaderOffset = 0x80
  const optionalHeaderSize = magic === 0x20b ? 0xf0 : 0xe0
  const optionalHeaderOffset = peHeaderOffset + 24
  const dataDirectoryOffset = optionalHeaderOffset + (magic === 0x20b ? 112 : 96)
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize
  const sectionRva = 0x1000
  const sectionRawOffset = 0x200
  const buffer = Buffer.alloc(0x800)

  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(peHeaderOffset, 0x3c)
  buffer.write('PE\0\0', peHeaderOffset, 'ascii')
  buffer.writeUInt16LE(1, peHeaderOffset + 6)
  buffer.writeUInt16LE(optionalHeaderSize, peHeaderOffset + 20)
  buffer.writeUInt16LE(magic, optionalHeaderOffset)
  buffer.writeUInt32LE(16, optionalHeaderOffset + (magic === 0x20b ? 108 : 92))
  buffer.writeUInt32LE(0x600, sectionTableOffset + 8)
  buffer.writeUInt32LE(sectionRva, sectionTableOffset + 12)
  buffer.writeUInt32LE(0x600, sectionTableOffset + 16)
  buffer.writeUInt32LE(sectionRawOffset, sectionTableOffset + 20)

  let nextNameOffset = 0x400
  function writeImportTable(
    names,
    tableRawOffset,
    descriptorSize,
    nameFieldOffset,
    directoryIndex,
  ) {
    if (names.length === 0) return
    buffer.writeUInt32LE(
      sectionRva + tableRawOffset - sectionRawOffset,
      dataDirectoryOffset + directoryIndex * 8,
    )
    names.forEach((name, index) => {
      const descriptorOffset = tableRawOffset + index * descriptorSize
      buffer.writeUInt32LE(
        sectionRva + nextNameOffset - sectionRawOffset,
        descriptorOffset + nameFieldOffset,
      )
      buffer.write(`${name}\0`, nextNameOffset, 'ascii')
      nextNameOffset += Buffer.byteLength(name) + 1
    })
  }

  writeImportTable(imports, 0x200, 20, 12, 1)
  writeImportTable(delayImports, 0x300, 32, 4, 13)
  return buffer
}

describe('portable executable dependency parser', () => {
  it.each([0x10b, 0x20b])('reads imports from PE magic 0x%s', (magic) => {
    const executable = buildPortableExecutable({
      magic,
      imports: ['libgcc_s_seh-1.dll', 'KERNEL32.dll'],
      delayImports: ['libwinpthread-1.dll', 'KERNEL32.dll'],
    })

    expect(parsePortableExecutableDependencyNames(executable)).toEqual([
      'libgcc_s_seh-1.dll',
      'KERNEL32.dll',
      'libwinpthread-1.dll',
    ])
  })

  it('returns an empty dependency list for malformed or truncated files', () => {
    expect(parsePortableExecutableDependencyNames(Buffer.from('not a PE'))).toEqual([])

    const truncated = buildPortableExecutable({ imports: ['example.dll'] }).subarray(0, 0x170)
    expect(parsePortableExecutableDependencyNames(truncated)).toEqual([])
  })

  it('ignores import name RVAs that do not map to a section', () => {
    const executable = buildPortableExecutable({ imports: ['example.dll'] })
    executable.writeUInt32LE(0x9000, 0x200 + 12)

    expect(parsePortableExecutableDependencyNames(executable)).toEqual([])
  })

  it('does not read data directories beyond the declared optional header', () => {
    const executable = buildPortableExecutable({ imports: ['example.dll'] })
    executable.writeUInt16LE(0x60, 0x80 + 20)

    expect(parsePortableExecutableDependencyNames(executable)).toEqual([])
  })
})
