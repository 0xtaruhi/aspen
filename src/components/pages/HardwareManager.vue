<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, watch } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  Server,
  Cpu,
  RefreshCw,
  Plug,
  Play,
  CheckCircle2,
  FileCode,
  Download,
  XCircle,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { projectStore } from '@/stores/project'
import { hardwareStore } from '@/stores/hardware'
import type { HardwarePhase } from '@/lib/hardware-client'

interface HardwareStatus {
  board: string
  description: string
  config: {
    smims_version: string
    fifo_words: number
    flash_total_block: number
    flash_block_size: number
    flash_cluster_size: number
    vericomm_enabled: boolean
    programmed: boolean
    pcb_connected: boolean
  }
}

interface HardwareTarget {
  id: string
  name: string
  type: 'server' | 'device'
  status: 'connected' | 'disconnected' | 'programming' | 'ready'
  children?: HardwareTarget[]
  details?: Record<string, string>
}

const hardwareState = hardwareStore.state
const hotplugLog = hardwareStore.hotplugLog

const selectedTargetId = ref<string | null>(null)
const programMessage = ref('')
const bitstreamFile = ref('')
const generationBytes = ref<number | null>(null)

const hardwareStatus = computed<HardwareStatus | null>(() => {
  const device = hardwareState.value.device
  if (!device) {
    return null
  }

  return {
    board: device.board,
    description: device.description,
    config: device.config,
  }
})

const flowPhase = computed<HardwarePhase>(() => hardwareState.value.phase)
const flowError = computed(() => hardwareState.value.last_error ?? '')
const errorMessage = computed(() => flowError.value)

const isBusy = computed(() => {
  return (
    flowPhase.value === 'probing' ||
    flowPhase.value === 'generating' ||
    flowPhase.value === 'programming'
  )
})

const isConnecting = computed(() => flowPhase.value === 'probing')
const isProgramming = computed(() => flowPhase.value === 'programming')

const lastRefresh = computed(() => {
  if (hardwareState.value.updated_at_ms <= 0) {
    return null
  }
  return new Date(hardwareState.value.updated_at_ms).toLocaleTimeString()
})

const targets = computed<HardwareTarget[]>(() => {
  if (!hardwareStatus.value) {
    return []
  }
  return buildTargets(hardwareStatus.value)
})

const selectedDevice = computed(() => {
  if (!selectedTargetId.value) return null
  for (const server of targets.value) {
    if (server.children) {
      const device = server.children.find((d) => d.id === selectedTargetId.value)
      if (device) return device
    }
  }
  return null
})

const canGenerate = computed(() => {
  return !!selectedDevice.value && !isBusy.value
})

const canProgram = computed(() => {
  return !!selectedDevice.value && !!bitstreamFile.value && !isBusy.value
})

const flowLabel = computed(() => {
  switch (flowPhase.value) {
    case 'probing':
      return 'Probing'
    case 'device_ready':
      return 'Ready'
    case 'generating':
      return 'Generating'
    case 'bitstream_ready':
      return 'Bitstream Ready'
    case 'programming':
      return 'Programming'
    case 'programmed':
      return 'Programmed'
    case 'error':
      return 'Error'
    case 'device_disconnected':
      return 'Disconnected'
    default:
      return 'Idle'
  }
})

const flowBadgeClass = computed(() => {
  if (flowPhase.value === 'programmed' || flowPhase.value === 'bitstream_ready') {
    return 'text-green-600 bg-green-500/10 border-green-200'
  }
  if (flowPhase.value === 'error' || flowPhase.value === 'device_disconnected') {
    return 'text-destructive bg-destructive/10 border-destructive/20'
  }
  if (
    flowPhase.value === 'generating' ||
    flowPhase.value === 'programming' ||
    flowPhase.value === 'probing'
  ) {
    return 'text-blue-600 bg-blue-500/10 border-blue-200'
  }
  return ''
})

watch(
  () => hardwareState.value.artifact,
  (artifact) => {
    if (artifact) {
      bitstreamFile.value = artifact.path
      generationBytes.value = artifact.bytes
      return
    }
    generationBytes.value = null
  },
  { immediate: true },
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

function buildTargets(status: HardwareStatus): HardwareTarget[] {
  return [
    {
      id: 'vlfd-host',
      name: 'Local VLFD',
      type: 'server',
      status: 'connected',
      children: [
        {
          id: 'fpga-0',
          name: status.board,
          type: 'device',
          status: status.config.programmed ? 'ready' : 'connected',
          details: {
            Chip: status.board,
            Description: status.description,
            'SMIMS Version': status.config.smims_version,
            'FIFO Words': status.config.fifo_words.toString(),
            'Flash Blocks': status.config.flash_total_block.toString(),
            'Flash Block Size': `${status.config.flash_block_size} bytes`,
            'Flash Cluster Size': `${status.config.flash_cluster_size} bytes`,
            VeriComm: status.config.vericomm_enabled ? 'Enabled' : 'Unavailable',
            'FPGA Programmed': status.config.programmed ? 'Yes' : 'No',
            'PCB Connected': status.config.pcb_connected ? 'Yes' : 'No',
          },
        },
      ],
    },
  ]
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function autoConnect() {
  if (isBusy.value) return
  programMessage.value = ''
  try {
    await hardwareStore.probe()
  } catch (err) {
    programMessage.value = `Probe failed: ${getErrorMessage(err)}`
  }
}

async function refreshStatus() {
  await autoConnect()
}

async function disconnect() {
  await hardwareStore.disconnectView()
  selectedTargetId.value = null
  bitstreamFile.value = ''
  generationBytes.value = null
  programMessage.value = ''
}

async function generateBitstream() {
  if (!canGenerate.value) return

  const sourceName = projectStore.activeFile?.name || 'top.v'
  const sourceCode = projectStore.code

  try {
    const nextState = await hardwareStore.generateBitstream(
      sourceName,
      sourceCode,
      bitstreamFile.value || null,
    )
    const artifact = nextState.artifact
    if (artifact) {
      bitstreamFile.value = artifact.path
      generationBytes.value = artifact.bytes
      programMessage.value = `Bitstream generated: ${artifact.path} (${artifact.bytes} bytes).`
    }
  } catch (err) {
    programMessage.value = `Bitstream generation failed: ${getErrorMessage(err)}`
  }
}

async function programDevice() {
  if (!canProgram.value || isProgramming.value) return
  if (!bitstreamFile.value) {
    programMessage.value = 'Please select or enter a bitstream file path.'
    return
  }

  try {
    await hardwareStore.programBitstream(bitstreamFile.value)
    programMessage.value = 'Bitstream programmed successfully.'
  } catch (err) {
    programMessage.value = `Programming failed: ${getErrorMessage(err)}`
  }
}

async function pickBitstream() {
  const selected = await openDialog({
    multiple: false,
    filters: [
      { name: 'Bitstream', extensions: ['bit', 'txt', 'bin'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (typeof selected === 'string') {
    bitstreamFile.value = selected
  }
}

onMounted(() => {
  hardwareStore.start().catch((err) => {
    programMessage.value = `Hardware watch failed: ${getErrorMessage(err)}`
  })
})

onBeforeUnmount(() => {
  hardwareStore.stop().catch(() => undefined)
})
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <!-- Toolbar -->
    <div class="h-12 border-b flex items-center px-4 gap-2 bg-muted/20">
      <Button variant="outline" size="sm" class="gap-2" :disabled="isBusy" @click="autoConnect">
        <Plug class="w-4 h-4" />
        {{ isConnecting ? 'Connecting...' : 'Auto Connect' }}
      </Button>

      <Button
        v-if="hardwareStatus"
        variant="ghost"
        size="sm"
        class="gap-2 text-destructive hover:text-destructive"
        @click="disconnect"
      >
        <XCircle class="w-4 h-4" />
        Disconnect
      </Button>

      <Separator orientation="vertical" class="h-6 mx-2" />

      <Button
        variant="ghost"
        size="icon"
        title="Refresh Targets"
        :disabled="isBusy"
        @click="refreshStatus"
      >
        <RefreshCw class="w-4 h-4" :class="isConnecting ? 'animate-spin' : ''" />
      </Button>

      <span v-if="lastRefresh" class="text-xs text-muted-foreground ml-2">
        Last probe: {{ lastRefresh }}
      </span>

      <span v-if="hotplugLog" class="text-xs text-muted-foreground ml-auto">
        {{ hotplugLog }}
      </span>

      <Badge variant="outline" class="ml-2" :class="flowBadgeClass">
        {{ flowLabel }}
      </Badge>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-hidden">
      <div
        v-if="errorMessage"
        class="bg-destructive/10 text-destructive text-sm px-4 py-2 border-b border-destructive/30"
      >
        {{ errorMessage }}
      </div>
      <ResizablePanelGroup direction="horizontal">
        <!-- Hardware Tree -->
        <ResizablePanel :default-size="25" :min-size="20" class="border-r bg-muted/10">
          <div class="p-2 font-medium text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Hardware Targets
          </div>
          <ScrollArea class="h-full">
            <div
              v-if="targets.length === 0"
              class="p-4 text-sm text-muted-foreground text-center italic"
            >
              No hardware targets open. <br />
              Click "Auto Connect" to start.
            </div>
            <div v-else class="px-2 space-y-1">
              <div v-for="server in targets" :key="server.id">
                <div
                  class="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer text-sm font-medium"
                >
                  <Server class="w-4 h-4 text-blue-500" />
                  {{ server.name }}
                  <Badge variant="outline" class="ml-auto text-[10px] h-5">Connected</Badge>
                </div>
                <div class="ml-4 border-l pl-2 mt-1 space-y-1">
                  <div
                    v-for="device in server.children"
                    :key="device.id"
                    class="flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors"
                    :class="
                      selectedTargetId === device.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted/50'
                    "
                    @click="selectedTargetId = device.id"
                  >
                    <Cpu
                      class="w-4 h-4"
                      :class="selectedTargetId === device.id ? 'text-primary' : 'text-orange-500'"
                    />
                    {{ device.name }}
                    <span
                      v-if="selectedTargetId === device.id"
                      class="ml-auto w-2 h-2 rounded-full bg-green-500"
                    ></span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle />

        <!-- Device Details & Operations -->
        <ResizablePanel :default-size="75" class="bg-background p-0">
          <ScrollArea class="h-full">
            <div
              v-if="selectedDevice"
              class="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 px-6 py-6"
            >
              <!-- Header -->
              <div class="flex items-start justify-between">
                <div>
                  <h2 class="text-2xl font-bold flex items-center gap-2">
                    <Cpu class="w-6 h-6 text-primary" />
                    {{ selectedDevice.name }}
                  </h2>
                  <p class="text-muted-foreground mt-1">{{ hardwareStatus?.description }}</p>
                </div>
                <Badge
                  :variant="hardwareStatus?.config.programmed ? 'secondary' : 'outline'"
                  :class="
                    hardwareStatus?.config.programmed
                      ? 'text-green-600 bg-green-500/10 border-green-200'
                      : ''
                  "
                >
                  <CheckCircle2 class="w-3 h-3 mr-1" />
                  {{ hardwareStatus?.config.programmed ? 'Programmed' : 'Detected' }}
                </Badge>
              </div>

              <!-- Device Properties Grid -->
              <div class="grid grid-cols-2 gap-4">
                <Card v-for="(value, key) in selectedDevice.details" :key="key">
                  <CardHeader class="pb-2">
                    <CardTitle class="text-xs font-medium text-muted-foreground uppercase">{{
                      key
                    }}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div class="text-lg font-mono">{{ value }}</div>
                  </CardContent>
                </Card>
              </div>

              <Separator />

              <!-- Programming Section -->
              <div class="space-y-4">
                <h3 class="text-lg font-semibold flex items-center gap-2">
                  <Download class="w-5 h-5" />
                  Program Device
                </h3>

                <div class="flex gap-4 items-end">
                  <div class="grid w-full max-w-sm items-center gap-1.5">
                    <label
                      for="bitstream"
                      class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >Bitstream File</label
                    >
                    <div class="flex w-full items-center space-x-2">
                      <div class="relative flex-1">
                        <FileCode class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="bitstream"
                          v-model="bitstreamFile"
                          placeholder="/path/to/fdp3p7.bit"
                          class="pl-9"
                        />
                      </div>
                      <Button
                        variant="secondary"
                        type="button"
                        :disabled="isBusy"
                        @click="pickBitstream"
                      >
                        Browse...
                      </Button>
                    </div>
                  </div>
                  <Button
                    class="w-40"
                    variant="outline"
                    :disabled="!canGenerate"
                    @click="generateBitstream"
                  >
                    <Cpu
                      class="w-4 h-4 mr-2"
                      :class="flowPhase === 'generating' ? 'animate-spin' : ''"
                    />
                    {{ flowPhase === 'generating' ? 'Generating...' : 'Generate Bitstream' }}
                  </Button>
                  <Button class="w-32" :disabled="!canProgram" @click="programDevice">
                    <Play v-if="!isProgramming" class="w-4 h-4 mr-2" />
                    {{ isProgramming ? 'Programming...' : 'Program' }}
                  </Button>
                </div>

                <p
                  v-if="generationBytes !== null && flowPhase === 'bitstream_ready'"
                  class="text-xs text-muted-foreground"
                >
                  Generated artifact size: {{ generationBytes }} bytes
                </p>

                <p
                  v-if="programMessage"
                  class="text-sm"
                  :class="
                    programMessage.toLowerCase().includes('failed')
                      ? 'text-destructive'
                      : 'text-green-600'
                  "
                >
                  {{ programMessage }}
                </p>
              </div>
            </div>
            <div
              v-else
              class="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4"
            >
              <div class="p-4 bg-muted/30 rounded-full">
                <Cpu class="w-12 h-12 opacity-50" />
              </div>
              <p>Select a hardware device to view details and program.</p>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>
</template>
