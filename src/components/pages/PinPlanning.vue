<script setup lang="ts">
import { Download, Eraser, Search, Wand2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import RecentProjectsPanel from '@/components/project/RecentProjectsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { exportConstraintXml } from '@/lib/project-constraint-io'
import {
  autoAssignProjectConstraints,
  buildConstraintAssignmentMap,
  buildConstraintXml,
  isLikelyClockPort,
  resolveCurrentProjectPinConstraints,
} from '@/lib/project-constraints'
import { getFpgaBoardDescriptor } from '@/lib/fpga-board-catalog'
import { useI18n } from '@/lib/i18n'
import { importProjectFiles, openProject } from '@/lib/project-io'
import { designContextStore } from '@/stores/design-context'
import { projectStore } from '@/stores/project'
import { signalCatalogStore, type SignalCatalogEntry } from '@/stores/signal-catalog'

const UNASSIGNED_PIN = '__unassigned__'

type PinPlanningFilter = 'all' | 'assigned' | 'unassigned' | 'conflicts'

const router = useRouter()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
const exportMessage = ref('')
const portSearch = ref('')
const activeFilter = ref<PinPlanningFilter>('all')
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))
const boardDescriptor = computed(() => getFpgaBoardDescriptor(projectStore.targetBoardId))
const expandedPorts = computed<readonly SignalCatalogEntry[]>(
  () => signalCatalogStore.signals.value,
)
const currentSynthesisReport = signalCatalogStore.currentSynthesisReport
const hasCurrentSynthesis = computed(() => Boolean(currentSynthesisReport.value))
const hasStaleSynthesis = signalCatalogStore.hasStaleSynthesisReport

const currentAssignments = computed(() => {
  return resolveCurrentProjectPinConstraints(
    projectStore.pinConstraints,
    projectStore.topFileId,
    expandedPorts.value,
  )
})

const assignmentMap = computed(() => buildConstraintAssignmentMap(currentAssignments.value))

const pinConflicts = computed(() => {
  const grouped = new Map<string, string[]>()

  for (const assignment of currentAssignments.value) {
    const ports = grouped.get(assignment.pinId) ?? []
    ports.push(assignment.portName)
    grouped.set(assignment.pinId, ports)
  }

  return new Map(
    Array.from(grouped.entries()).filter(([, portNames]) => {
      return portNames.length > 1
    }),
  )
})

const topModule = computed(() => {
  return currentSynthesisReport.value?.top_module ?? designContextStore.primaryModule.value
})

const constraintXml = computed(() => {
  return buildConstraintXml(topModule.value, currentAssignments.value)
})

const compatiblePinGroups = computed(() => {
  const board = boardDescriptor.value
  return {
    input: board.pins.filter((pin) => pin.role === 'input'),
    output: board.pins.filter((pin) => pin.role === 'output'),
    clock: board.pins.filter((pin) => pin.role === 'clock'),
  }
})

const compatiblePinMap = computed(() => {
  const { input, output, clock } = compatiblePinGroups.value
  const map = new Map<string, typeof boardDescriptor.value.pins>()

  for (const port of expandedPorts.value) {
    if (port.direction === 'output') {
      map.set(port.bitName, output)
      continue
    }

    if (port.direction === 'inout') {
      map.set(port.bitName, [...input, ...output])
      continue
    }

    map.set(
      port.bitName,
      isLikelyClockPort(port.bitName) ? [...clock, ...input] : [...input, ...clock],
    )
  }

  return map
})

const rowStateMap = computed(() => {
  const map = new Map<
    string,
    {
      assignment: ReturnType<typeof assignmentMap.value.get> | null
      conflicted: boolean
    }
  >()

  for (const port of expandedPorts.value) {
    const assignment = assignmentMap.value.get(port.bitName) ?? null
    map.set(port.bitName, {
      assignment,
      conflicted: assignment ? pinConflicts.value.has(assignment.pinId) : false,
    })
  }

  return map
})

const normalizedSearch = computed(() => portSearch.value.trim().toLowerCase())

const filterCounts = computed(() => {
  const counts: Record<PinPlanningFilter, number> = {
    all: expandedPorts.value.length,
    assigned: 0,
    unassigned: 0,
    conflicts: 0,
  }

  for (const port of expandedPorts.value) {
    const rowState = rowStateMap.value.get(port.bitName)
    if (!rowState?.assignment) {
      counts.unassigned += 1
      continue
    }

    if (rowState.conflicted) {
      counts.conflicts += 1
      continue
    }

    counts.assigned += 1
  }

  return counts
})

const filterOptions = computed<
  Array<{
    value: PinPlanningFilter
    label: string
    count: number
  }>
>(() => [
  {
    value: 'all',
    label: t('allPorts'),
    count: filterCounts.value.all,
  },
  {
    value: 'assigned',
    label: t('assignedPins'),
    count: filterCounts.value.assigned,
  },
  {
    value: 'unassigned',
    label: t('unassignedPins'),
    count: filterCounts.value.unassigned,
  },
  {
    value: 'conflicts',
    label: t('conflicts'),
    count: filterCounts.value.conflicts,
  },
])

const filteredPorts = computed(() => {
  return expandedPorts.value.filter((port) => {
    const rowState = rowStateMap.value.get(port.bitName)
    const matchesSearch =
      normalizedSearch.value.length === 0 ||
      port.bitName.toLowerCase().includes(normalizedSearch.value) ||
      port.baseName.toLowerCase().includes(normalizedSearch.value)

    if (!matchesSearch) {
      return false
    }

    switch (activeFilter.value) {
      case 'assigned':
        return Boolean(rowState?.assignment) && !rowState?.conflicted
      case 'unassigned':
        return !rowState?.assignment
      case 'conflicts':
        return Boolean(rowState?.assignment) && Boolean(rowState?.conflicted)
      default:
        return true
    }
  })
})

const filteredPortSummary = computed(() => {
  return t('showingPortsSummary', {
    visible: filteredPorts.value.length,
    total: expandedPorts.value.length,
  })
})

const emptyTableMessage = computed(() => {
  return expandedPorts.value.length === 0 ? t('noTopPortsAvailable') : t('noMatchingPorts')
})

function rowState(port: SignalCatalogEntry) {
  return (
    rowStateMap.value.get(port.bitName) ?? {
      assignment: null,
      conflicted: false,
    }
  )
}

function compatiblePins(port: SignalCatalogEntry) {
  return compatiblePinMap.value.get(port.bitName) ?? []
}

function handlePinUpdate(port: SignalCatalogEntry, value: unknown) {
  if (typeof value !== 'string') {
    return
  }

  if (value === UNASSIGNED_PIN) {
    projectStore.clearPinConstraint(projectStore.topFileId, port.bitName)
    return
  }

  const selectedPin = boardDescriptor.value.pins.find((pin) => pin.id === value)
  projectStore.setPinConstraint(projectStore.topFileId, {
    portName: port.bitName,
    pinId: value,
    boardFunction: selectedPin?.boardFunction ?? null,
  })
}

function autoAssignPins() {
  projectStore.replacePinConstraints(
    projectStore.topFileId,
    autoAssignProjectConstraints(expandedPorts.value, boardDescriptor.value),
  )
}

function clearAssignments() {
  projectStore.clearPinConstraints(projectStore.topFileId)
}

async function exportXml() {
  const savedPath = await exportConstraintXml(constraintXml.value)
  exportMessage.value = savedPath ? t('constraintExportedTo', { path: savedPath }) : ''
}

function goToSynthesis() {
  void router.push({ name: 'fpga-flow-synthesis' })
}
</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />
  <div
    class="flex h-full min-h-0 flex-col gap-6 overflow-hidden p-8 animate-in fade-in duration-500"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">{{ t('pinPlanning') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('pinAssignmentsDescription') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant="outline">{{ boardDescriptor.displayName }}</Badge>
      </div>
    </div>

    <Card v-if="!projectStore.hasProject || !hasDesignSource" class="max-w-3xl">
      <CardHeader>
        <CardTitle>
          {{ projectStore.hasProject ? t('noDesignSourceLoaded') : t('noProjectLoaded') }}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{
            projectStore.hasProject
              ? t('noDesignSourceLoadedDescription')
              : t('noProjectLoadedDescription')
          }}
        </p>
        <div class="flex flex-wrap gap-3">
          <template v-if="projectStore.hasProject">
            <Button type="button" variant="outline" @click="importProjectFiles">
              {{ t('importFiles') }}
            </Button>
          </template>
          <template v-else>
            <Button type="button" @click="showNewProjectDialog = true">
              {{ t('createProject') }}
            </Button>
            <Button type="button" variant="outline" @click="openProject">
              {{ t('openProject') }}
            </Button>
            <div class="w-full pt-1">
              <RecentProjectsPanel />
            </div>
          </template>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="!hasCurrentSynthesis" class="max-w-3xl">
      <CardHeader>
        <CardTitle>
          {{
            hasStaleSynthesis
              ? t('pinPlanningSynthesisOutdated')
              : t('pinPlanningRequiresSynthesis')
          }}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{
            hasStaleSynthesis
              ? t('pinPlanningSynthesisOutdatedDescription')
              : t('pinPlanningRequiresSynthesisDescription')
          }}
        </p>
        <div class="flex flex-wrap gap-3">
          <Button type="button" @click="goToSynthesis">
            {{ t('runSynthesis') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <template v-else>
      <Card class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader class="space-y-3 border-b border-border/60 bg-muted/10 pb-4">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0">
              <CardTitle>{{ t('pinAssignments') }}</CardTitle>
              <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{{ designContextStore.sourceName.value }}</Badge>
                <Badge v-if="pinConflicts.size > 0" variant="destructive">
                  {{ t('conflicts') }}: {{ pinConflicts.size }}
                </Badge>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="gap-1.5"
                @click="autoAssignPins"
              >
                <Wand2 class="h-3.5 w-3.5" />
                {{ t('autoAssign') }}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="gap-1.5"
                @click="clearAssignments"
              >
                <Eraser class="h-3.5 w-3.5" />
                {{ t('clearAll') }}
              </Button>
              <Button type="button" size="sm" class="gap-1.5" @click="exportXml">
                <Download class="h-3.5 w-3.5" />
                {{ t('exportConstraintXml') }}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <p v-if="exportMessage" class="text-sm text-muted-foreground">{{ exportMessage }}</p>
          <div class="rounded-xl border border-border/70 bg-muted/20 p-3">
            <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div class="relative w-full max-w-sm">
                <Search
                  class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input v-model="portSearch" :placeholder="t('searchPorts')" class="pl-9" />
              </div>
              <div
                class="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1"
              >
                <button
                  v-for="option in filterOptions"
                  :key="option.value"
                  type="button"
                  class="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors"
                  :class="
                    activeFilter === option.value
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:bg-muted'
                  "
                  @click="activeFilter = option.value"
                >
                  <span>{{ option.label }}</span>
                  <span
                    class="rounded-full px-1.5 py-0.5 text-[11px]"
                    :class="
                      activeFilter === option.value
                        ? 'bg-background/20 text-background'
                        : 'bg-muted text-muted-foreground'
                    "
                  >
                    {{ option.count }}
                  </span>
                </button>
              </div>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">{{ filteredPortSummary }}</p>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70">
            <ScrollArea class="h-full">
              <Table>
                <TableHeader
                  class="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
                >
                  <TableRow>
                    <TableHead class="bg-inherit">{{ t('direction') }}</TableHead>
                    <TableHead class="bg-inherit">{{ t('portName') }}</TableHead>
                    <TableHead class="bg-inherit">{{ t('pin') }}</TableHead>
                    <TableHead class="bg-inherit">{{ t('status') }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="port in filteredPorts" :key="port.bitName">
                    <TableCell>
                      <Badge variant="outline">{{ t(`${port.direction}Direction`) }}</Badge>
                    </TableCell>
                    <TableCell class="font-mono text-xs">
                      <div class="flex items-center gap-2">
                        <span>{{ port.bitName }}</span>
                        <Badge v-if="isLikelyClockPort(port.baseName)" variant="secondary">
                          CLK
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell class="min-w-[220px]">
                      <select
                        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        :value="rowState(port).assignment?.pinId ?? UNASSIGNED_PIN"
                        @change="handlePinUpdate(port, ($event.target as HTMLSelectElement).value)"
                      >
                        <option :value="UNASSIGNED_PIN">{{ t('noBinding') }}</option>
                        <option
                          v-for="pin in compatiblePins(port)"
                          :key="`${port.bitName}-${pin.id}`"
                          :value="pin.id"
                        >
                          {{ pin.id }}
                        </option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <span
                        v-if="rowState(port).conflicted"
                        class="text-sm font-medium text-destructive"
                      >
                        {{ t('pinConflict') }}
                      </span>
                      <span
                        v-else-if="rowState(port).assignment?.pinId"
                        class="text-sm text-emerald-600"
                      >
                        {{ t('mapped') }}
                      </span>
                      <span v-else class="text-sm text-muted-foreground">{{ t('unbound') }}</span>
                    </TableCell>
                  </TableRow>
                  <TableEmpty v-if="filteredPorts.length === 0" :colspan="4">
                    {{ emptyTableMessage }}
                  </TableEmpty>
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
