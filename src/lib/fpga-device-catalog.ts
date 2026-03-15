export type FpgaDeviceResources = {
  lut4: number
  ff: number
  slices: number
  bramBlocks: number
  bramBitsPerBlock: number
}

export type FpgaDeviceIo = {
  inputPins: number
  outputPins: number
  dedicatedClockPins: number
  defaultClockPin: string
}

type FpgaDeviceDefinition = {
  displayName: string
  family: string
  architectureName: string
  resources: FpgaDeviceResources
  io: FpgaDeviceIo
}

const catalog = {
  FDP3P7: {
    displayName: 'FDP3P7',
    family: 'FDP3',
    architectureName: 'fdp3000k',
    resources: {
      lut4: 6144,
      ff: 6144,
      slices: 3072,
      bramBlocks: 64,
      bramBitsPerBlock: 4096,
    },
    io: {
      inputPins: 54,
      outputPins: 54,
      dedicatedClockPins: 1,
      defaultClockPin: 'P77',
    },
  },
} satisfies Record<string, FpgaDeviceDefinition>

export type FpgaDeviceId = keyof typeof catalog

export type FpgaDeviceDescriptor = FpgaDeviceDefinition & {
  id: FpgaDeviceId
}

export const defaultFpgaDeviceId: FpgaDeviceId = 'FDP3P7'

const catalogEntries = Object.entries(catalog) as [FpgaDeviceId, FpgaDeviceDefinition][]

export const allFpgaDeviceDescriptors: FpgaDeviceDescriptor[] = catalogEntries.map(
  ([id, descriptor]) => ({
    id,
    ...descriptor,
  }),
)

export function isFpgaDeviceId(value: unknown): value is FpgaDeviceId {
  return typeof value === 'string' && value in catalog
}

export function resolveFpgaDeviceId(value: string | null | undefined): FpgaDeviceId | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toUpperCase()
  return isFpgaDeviceId(normalized) ? normalized : null
}

export function normalizeFpgaDeviceId(value: unknown): FpgaDeviceId {
  return isFpgaDeviceId(value) ? value : defaultFpgaDeviceId
}

export function getFpgaDeviceDescriptor(
  deviceId: FpgaDeviceId = defaultFpgaDeviceId,
): FpgaDeviceDescriptor {
  return {
    id: deviceId,
    ...catalog[deviceId],
  }
}
