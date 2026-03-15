import { type FpgaDeviceId } from './fpga-device-catalog'

export type FpgaBoardPinRole = 'input' | 'output' | 'clock'

export type FpgaBoardPinDescriptor = {
  id: string
  role: FpgaBoardPinRole
  boardFunction: string | null
}

type FpgaBoardDefinition = {
  displayName: string
  deviceId: FpgaDeviceId
  pins: FpgaBoardPinDescriptor[]
}

const fdp3p7InputPins = [
  'P151',
  'P148',
  'P150',
  'P152',
  'P160',
  'P161',
  'P162',
  'P163',
  'P164',
  'P165',
  'P166',
  'P169',
  'P173',
  'P174',
  'P175',
  'P191',
  'P120',
  'P116',
  'P115',
  'P114',
  'P113',
  'P112',
  'P111',
  'P108',
  'P102',
  'P101',
  'P100',
  'P97',
  'P96',
  'P95',
  'P89',
  'P88',
  'P87',
  'P86',
  'P81',
  'P75',
  'P74',
  'P70',
  'P69',
  'P68',
  'P64',
  'P62',
  'P61',
  'P58',
  'P57',
  'P49',
  'P47',
  'P48',
  'P192',
  'P193',
  'P199',
  'P200',
  'P201',
  'P202',
] as const

const fdp3p7OutputPins = [
  'P7',
  'P6',
  'P5',
  'P4',
  'P9',
  'P8',
  'P16',
  'P15',
  'P11',
  'P10',
  'P20',
  'P18',
  'P17',
  'P22',
  'P21',
  'P23',
  'P44',
  'P45',
  'P46',
  'P43',
  'P40',
  'P41',
  'P42',
  'P33',
  'P34',
  'P35',
  'P36',
  'P30',
  'P31',
  'P24',
  'P27',
  'P29',
  'P110',
  'P109',
  'P99',
  'P98',
  'P94',
  'P93',
  'P84',
  'P83',
  'P82',
  'P73',
  'P71',
  'P63',
  'P60',
  'P59',
  'P56',
  'P55',
  'P167',
  'P168',
  'P176',
  'P187',
  'P189',
  'P194',
] as const

const catalog = {
  FDP3P7_REFERENCE: {
    displayName: 'FDP3P7 Reference Board',
    deviceId: 'FDP3P7',
    pins: [
      ...fdp3p7InputPins.map((id) => ({
        id,
        role: 'input' as const,
        boardFunction: null,
      })),
      ...fdp3p7OutputPins.map((id) => ({
        id,
        role: 'output' as const,
        boardFunction: null,
      })),
      {
        id: 'P77',
        role: 'clock' as const,
        boardFunction: 'CLK',
      },
    ],
  },
} satisfies Record<string, FpgaBoardDefinition>

export type FpgaBoardId = keyof typeof catalog

export type FpgaBoardDescriptor = FpgaBoardDefinition & {
  id: FpgaBoardId
}

const catalogEntries = Object.entries(catalog) as [FpgaBoardId, FpgaBoardDefinition][]

export const defaultFpgaBoardId: FpgaBoardId = 'FDP3P7_REFERENCE'

export const allFpgaBoardDescriptors: FpgaBoardDescriptor[] = catalogEntries.map(([id, board]) => ({
  id,
  ...board,
}))

export function isFpgaBoardId(value: unknown): value is FpgaBoardId {
  return typeof value === 'string' && value in catalog
}

export function normalizeFpgaBoardId(value: unknown, fallback: FpgaBoardId = defaultFpgaBoardId) {
  return isFpgaBoardId(value) ? value : fallback
}

export function getFpgaBoardDescriptor(
  boardId: FpgaBoardId = defaultFpgaBoardId,
): FpgaBoardDescriptor {
  return {
    id: boardId,
    ...catalog[boardId],
  }
}

export function getDefaultFpgaBoardIdForDevice(deviceId: FpgaDeviceId): FpgaBoardId {
  const match = allFpgaBoardDescriptors.find((board) => board.deviceId === deviceId)
  return match?.id ?? defaultFpgaBoardId
}
