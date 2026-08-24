function readDirectoryRva(
  fileBuffer,
  dataDirectoryOffset,
  dataDirectoryEnd,
  directoryCount,
  entryIndex,
) {
  const entryOffset = dataDirectoryOffset + entryIndex * 8
  return entryIndex < directoryCount && entryOffset + 8 <= dataDirectoryEnd
    ? fileBuffer.readUInt32LE(entryOffset)
    : 0
}

function rvaToOffset(rva, sections) {
  for (const section of sections) {
    const sectionSize = Math.max(section.virtualSize, section.rawSize)
    if (rva >= section.virtualAddress && rva < section.virtualAddress + sectionSize) {
      return section.rawOffset + (rva - section.virtualAddress)
    }
  }
  return null
}

function readNullTerminatedAscii(fileBuffer, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= fileBuffer.length) {
    return ''
  }

  let endOffset = offset
  while (endOffset < fileBuffer.length && fileBuffer[endOffset] !== 0) {
    endOffset += 1
  }
  return fileBuffer.toString('ascii', offset, endOffset).trim()
}

function collectImportedDllNames(
  fileBuffer,
  sections,
  tableRva,
  descriptorSize,
  nameFieldOffset,
  importedNames,
) {
  const tableOffset = tableRva ? rvaToOffset(tableRva, sections) : null
  if (tableOffset === null || tableOffset >= fileBuffer.length) {
    return
  }

  for (
    let descriptorOffset = tableOffset;
    descriptorOffset + descriptorSize <= fileBuffer.length;
    descriptorOffset += descriptorSize
  ) {
    const descriptor = fileBuffer.subarray(descriptorOffset, descriptorOffset + descriptorSize)
    if (descriptor.every((byte) => byte === 0)) {
      break
    }

    const nameRva = descriptor.readUInt32LE(nameFieldOffset)
    const nameOffset = rvaToOffset(nameRva, sections)
    const dependencyName =
      nameOffset === null ? '' : readNullTerminatedAscii(fileBuffer, nameOffset)
    if (dependencyName) {
      importedNames.add(dependencyName)
    }
  }
}

export function parsePortableExecutableDependencyNames(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 0x40) {
    return []
  }
  if (fileBuffer.toString('ascii', 0, 2) !== 'MZ') {
    return []
  }

  const peHeaderOffset = fileBuffer.readUInt32LE(0x3c)
  if (
    peHeaderOffset <= 0 ||
    peHeaderOffset + 24 > fileBuffer.length ||
    fileBuffer.toString('ascii', peHeaderOffset, peHeaderOffset + 4) !== 'PE\u0000\u0000'
  ) {
    return []
  }

  const fileHeaderOffset = peHeaderOffset + 4
  const numberOfSections = fileBuffer.readUInt16LE(fileHeaderOffset + 2)
  const optionalHeaderSize = fileBuffer.readUInt16LE(fileHeaderOffset + 16)
  const optionalHeaderOffset = fileHeaderOffset + 20
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize
  if (
    optionalHeaderSize < 2 ||
    sectionTableOffset > fileBuffer.length ||
    sectionTableOffset + numberOfSections * 40 > fileBuffer.length
  ) {
    return []
  }

  const optionalHeaderMagic = fileBuffer.readUInt16LE(optionalHeaderOffset)
  const dataDirectoryOffset = optionalHeaderOffset + (optionalHeaderMagic === 0x10b ? 96 : 112)
  const directoryCountOffset = optionalHeaderOffset + (optionalHeaderMagic === 0x10b ? 92 : 108)
  if (
    (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) ||
    directoryCountOffset + 4 > sectionTableOffset ||
    dataDirectoryOffset > sectionTableOffset
  ) {
    return []
  }
  const directoryCount = fileBuffer.readUInt32LE(directoryCountOffset)

  const sections = []
  for (let index = 0; index < numberOfSections; index += 1) {
    const offset = sectionTableOffset + index * 40
    sections.push({
      virtualSize: fileBuffer.readUInt32LE(offset + 8),
      virtualAddress: fileBuffer.readUInt32LE(offset + 12),
      rawSize: fileBuffer.readUInt32LE(offset + 16),
      rawOffset: fileBuffer.readUInt32LE(offset + 20),
    })
  }

  const importedNames = new Set()
  collectImportedDllNames(
    fileBuffer,
    sections,
    readDirectoryRva(fileBuffer, dataDirectoryOffset, sectionTableOffset, directoryCount, 1),
    20,
    12,
    importedNames,
  )
  collectImportedDllNames(
    fileBuffer,
    sections,
    readDirectoryRva(fileBuffer, dataDirectoryOffset, sectionTableOffset, directoryCount, 13),
    32,
    4,
    importedNames,
  )
  return [...importedNames]
}
