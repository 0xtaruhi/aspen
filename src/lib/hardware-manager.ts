import type { MessageKey } from '@/lib/i18n'
import type {
  HardwareBoardInfoV1,
  HardwareBoardSelectorV1,
  HardwareDeviceSnapshot,
  HardwarePhase,
} from '@/lib/hardware-client'

import { computed, onMounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

import { hardwareBoardSelectorKey, syncHardwareAccess } from '@/lib/hardware-access'
import { hardwareListBoards } from '@/lib/hardware-client'
import {
  getFpgaDeviceDescriptor,
  normalizeFpgaDeviceId,
  resolveFpgaDeviceId,
} from '@/lib/fpga-device-catalog'
import { describeHardwareError } from '@/lib/hardware-errors'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { programmingCatalogStore } from '@/stores/programming-catalog'
import { projectStore } from '@/stores/project'
import { settingsStore } from '@/stores/settings'

export interface HardwareTarget {
  id: string
  name: string
  type: 'server' | 'device'
  status: 'connected' | 'disconnected' | 'programming' | 'ready'
  children?: HardwareTarget[]
  details?: Record<string, string>
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export function parseVlfdCustomerId(value: string): number | null {
  const normalized = value.trim()
  const radix = normalized.toLowerCase().startsWith('0x') ? 16 : 10
  const digits = radix === 16 ? normalized.slice(2) : normalized
  if (!digits || !(radix === 16 ? /^[0-9a-f]+$/i : /^\d+$/.test(digits))) {
    return null
  }
  const customerId = Number.parseInt(digits, radix)
  return customerId <= 0xffff ? customerId : null
}

function boardLabel(board: HardwareBoardInfoV1) {
  if (board.serial_number) {
    return board.serial_number
  }
  if (board.selector.kind === 'usb_location') {
    return `USB ${board.selector.bus_id}/${board.selector.port_chain.join('.')}`
  }
  return `USB #${board.address}`
}

export function buildHardwareTargets(
  status: HardwareDeviceSnapshot,
  projectTargetDeviceId: string,
  t: Translate,
): HardwareTarget[] {
  const deviceId = resolveFpgaDeviceId(status.board) ?? normalizeFpgaDeviceId(projectTargetDeviceId)
  const deviceDescriptor = getFpgaDeviceDescriptor(deviceId)

  return [
    {
      id: 'vlfd-host',
      name: t('localVlfd'),
      type: 'server',
      status: 'connected',
      children: [
        {
          id: 'fpga-0',
          name: status.board,
          type: 'device',
          status: !status.config.pcb_connected
            ? 'disconnected'
            : status.config.programmed
              ? 'ready'
              : 'connected',
          details: {
            [t('chip')]: status.board,
            [t('deviceFamily')]: deviceDescriptor.family,
            [t('architecture')]: deviceDescriptor.architectureName,
            [t('sliceCount')]: deviceDescriptor.resources.slices.toLocaleString(),
            [t('lutCount')]: deviceDescriptor.resources.lut4.toLocaleString(),
            [t('ffCount')]: deviceDescriptor.resources.ff.toLocaleString(),
            [t('bramCount')]: t('bramCountValue', {
              count: deviceDescriptor.resources.bramBlocks,
              bits: deviceDescriptor.resources.bramBitsPerBlock.toLocaleString(),
            }),
            [t('availableIo')]: t('availableIoValue', {
              inputs: deviceDescriptor.io.inputPins,
              outputs: deviceDescriptor.io.outputPins,
              clocks: deviceDescriptor.io.dedicatedClockPins,
              pin: deviceDescriptor.io.defaultClockPin,
            }),
            [t('descriptionLabel')]: status.description,
            [t('smimsVersion')]: status.config.smims_version,
            [t('fifoWords')]: status.config.fifo_words.toString(),
            [t('flashBlocks')]: status.config.flash_total_block.toString(),
            [t('flashBlockSize')]: t('bytesValue', { count: status.config.flash_block_size }),
            [t('flashClusterSize')]: t('bytesValue', { count: status.config.flash_cluster_size }),
            [t('veriComm')]: status.config.vericomm_enabled ? t('enabled') : t('unavailable'),
            [t('fpgaProgrammed')]: status.config.programmed ? t('yes') : t('no'),
            [t('pcbConnected')]: status.config.pcb_connected ? t('yes') : t('no'),
          },
        },
      ],
    },
  ]
}

export function resolveHardwareFlowLabel(phase: HardwarePhase, t: Translate) {
  switch (phase) {
    case 'probing':
      return t('probing')
    case 'device_ready':
      return t('ready')
    case 'programming':
      return t('programming')
    case 'error':
      return t('error')
    case 'device_disconnected':
      return t('disconnected')
    default:
      return ''
  }
}

export function resolveHardwareFlowBadgeClass(phase: HardwarePhase) {
  if (phase === 'error' || phase === 'device_disconnected') {
    return 'text-destructive bg-destructive/10 border-destructive/20'
  }
  if (phase === 'programming' || phase === 'probing') {
    return 'text-blue-600 bg-blue-500/10 border-blue-200'
  }
  return ''
}

export function shouldShowHardwareFlowBadge(phase: HardwarePhase) {
  return (
    phase === 'probing' ||
    phase === 'programming' ||
    phase === 'error' ||
    phase === 'device_disconnected'
  )
}

export function useHardwareManagerState() {
  const { t } = useI18n()
  const selectedTargetId = ref<string | null>(null)
  const isProgramDialogOpen = ref(false)
  const programMessage = ref('')
  const programMessageTone = ref<'success' | 'error'>('success')
  const bitstreamFile = ref('')
  const availableBoards = ref<HardwareBoardInfoV1[]>([])
  const customerIdInput = ref(
    settingsStore.state.vlfdCustomerId === null
      ? ''
      : `0x${settingsStore.state.vlfdCustomerId.toString(16)}`,
  )

  const hardwareState = hardwareStore.state
  const hotplugLog = hardwareStore.hotplugLog
  const defaultBitstreamPath = programmingCatalogStore.defaultBitstreamPath

  const hardwareStatus = computed(() => hardwareState.value.device)
  const flowPhase = computed<HardwarePhase>(() => hardwareState.value.phase)
  const errorMessage = computed(() => {
    const message = hardwareState.value.last_error
    return message ? describeHardwareError(message, { phase: flowPhase.value }) : ''
  })
  const isBusy = computed(() => {
    return flowPhase.value === 'probing' || flowPhase.value === 'programming'
  })
  const isConnecting = computed(() => flowPhase.value === 'probing')
  const isProgramming = computed(() => flowPhase.value === 'programming')
  const targets = computed<HardwareTarget[]>(() => {
    if (!hardwareStatus.value) {
      return []
    }

    return buildHardwareTargets(hardwareStatus.value, projectStore.targetDeviceId, t)
  })
  const selectedDevice = computed(() => {
    if (!selectedTargetId.value) {
      return null
    }

    for (const server of targets.value) {
      const device = server.children?.find((child) => child.id === selectedTargetId.value)
      if (device) {
        return device
      }
    }

    return null
  })
  const isDeviceConnected = computed(() => {
    return Boolean(selectedDevice.value && hardwareStatus.value?.config.pcb_connected)
  })
  const canProgram = computed(() => {
    return isDeviceConnected.value && !!bitstreamFile.value.trim() && !isBusy.value
  })
  const canOpenProgramDialog = computed(() => {
    return isDeviceConnected.value && !isBusy.value
  })
  const flowLabel = computed(() => resolveHardwareFlowLabel(flowPhase.value, t))
  const showToolbarFlowBadge = computed(() => shouldShowHardwareFlowBadge(flowPhase.value))
  const flowBadgeClass = computed(() => resolveHardwareFlowBadgeClass(flowPhase.value))
  const boardOptions = computed(() => [
    {
      key: 'only',
      label: t('automaticSingleBoard'),
      selector: { kind: 'only' } as HardwareBoardSelectorV1,
    },
    ...availableBoards.value.map((board) => ({
      key: hardwareBoardSelectorKey(board.selector),
      label: boardLabel(board),
      selector: board.selector,
    })),
  ])
  const selectedBoardKey = computed(() =>
    hardwareBoardSelectorKey(settingsStore.state.hardwareBoardSelector),
  )

  watch(
    targets,
    (nextTargets) => {
      const defaultTargetId = nextTargets[0]?.children?.[0]?.id ?? null
      if (!defaultTargetId) {
        selectedTargetId.value = null
        return
      }

      const exists = nextTargets.some((target) =>
        target.children?.some((child) => child.id === selectedTargetId.value),
      )
      if (!exists) {
        selectedTargetId.value = defaultTargetId
      }
    },
    { immediate: true },
  )

  async function autoConnect() {
    if (isBusy.value) {
      return
    }

    programMessage.value = ''
    programMessageTone.value = 'success'

    try {
      await refreshBoards()
      await hardwareStore.probe()
    } catch (error) {
      programMessageTone.value = 'error'
      programMessage.value = t('probeFailed', { message: describeHardwareError(error) })
    }
  }

  async function refreshBoards() {
    if (!isTauri()) {
      availableBoards.value = []
      return
    }
    availableBoards.value = await hardwareListBoards()
  }

  async function handleBoardSelection(value: unknown) {
    if (typeof value !== 'string') {
      return
    }
    const option = boardOptions.value.find((candidate) => candidate.key === value)
    if (!option) {
      return
    }
    settingsStore.setHardwareBoardSelector(option.selector)
    try {
      await syncHardwareAccess()
      await autoConnect()
    } catch (error) {
      programMessageTone.value = 'error'
      programMessage.value = t('probeFailed', { message: describeHardwareError(error) })
    }
  }

  async function commitCustomerId() {
    const customerId = parseVlfdCustomerId(customerIdInput.value)
    if (customerId === null) {
      programMessageTone.value = 'error'
      programMessage.value = t('invalidVlfdCustomerId')
      return
    }
    settingsStore.setVlfdCustomerId(customerId)
    customerIdInput.value = `0x${customerId.toString(16)}`
    try {
      await syncHardwareAccess()
      programMessage.value = ''
    } catch (error) {
      programMessageTone.value = 'error'
      programMessage.value = describeHardwareError(error)
    }
  }

  async function refreshStatus() {
    await autoConnect()
  }

  async function disconnect() {
    await hardwareStore.disconnectView()
    selectedTargetId.value = null
    isProgramDialogOpen.value = false
    bitstreamFile.value = ''
    programMessage.value = ''
    programMessageTone.value = 'success'
  }

  async function programDevice() {
    if (!canProgram.value || isProgramming.value) {
      return
    }

    if (!bitstreamFile.value.trim()) {
      programMessageTone.value = 'error'
      programMessage.value = t('selectBitstreamPath')
      return
    }

    try {
      await hardwareStore.programBitstream(bitstreamFile.value)
      programMessageTone.value = 'success'
      programMessage.value = t('bitstreamProgrammedSuccessfully')
      isProgramDialogOpen.value = false
    } catch (error) {
      programMessageTone.value = 'error'
      programMessage.value = t('programmingFailed', { message: describeHardwareError(error) })
    }
  }

  function openProgramDialog() {
    if (!canOpenProgramDialog.value) {
      return
    }

    bitstreamFile.value = defaultBitstreamPath.value
    isProgramDialogOpen.value = true
  }

  onMounted(() => {
    void refreshBoards().catch((error) => {
      programMessageTone.value = 'error'
      programMessage.value = describeHardwareError(error)
    })
  })

  async function pickBitstream() {
    const selected = await openDialog({
      multiple: false,
      defaultPath: bitstreamFile.value || defaultBitstreamPath.value || undefined,
      filters: [
        { name: t('bitstreamFilter'), extensions: ['bit', 'txt', 'bin'] },
        { name: t('allFiles'), extensions: ['*'] },
      ],
    })

    if (typeof selected === 'string') {
      bitstreamFile.value = selected
    }
  }

  return {
    autoConnect,
    boardOptions,
    bitstreamFile,
    canOpenProgramDialog,
    canProgram,
    commitCustomerId,
    customerIdInput,
    defaultBitstreamPath,
    disconnect,
    errorMessage,
    flowBadgeClass,
    flowLabel,
    hardwareStatus,
    hotplugLog,
    isBusy,
    isConnecting,
    isProgramDialogOpen,
    isProgramming,
    handleBoardSelection,
    openProgramDialog,
    pickBitstream,
    programDevice,
    programMessage,
    programMessageTone,
    refreshStatus,
    selectedBoardKey,
    selectedDevice,
    selectedTargetId,
    showToolbarFlowBadge,
    targets,
    t,
  }
}
