<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { signalCatalogStore, type SignalCatalogEntry } from '@/stores/signal-catalog'

const UNASSIGNED_PIN = '__unassigned__'

const router = useRouter()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
const exportMessage = ref('')
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))
const boardDescriptor = computed(() => getFpgaBoardDescriptor(projectStore.targetBoardId))
const expandedPorts = computed<readonly SignalCatalogEntry[]>(
  () => signalCatalogStore.signals.value,
)
const currentSynthesisReport = signalCatalogStore.currentSynthesisReport
const hasCurrentSynthesis = computed(() => Boolean(currentSynthesisReport.value))
const hasStaleSynthesis = computed(() => {
  return Boolean(hardwareStore.synthesisReport.value?.success) && !hasCurrentSynthesis.value
})

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

function rowAssignment(port: SignalCatalogEntry) {
  return assignmentMap.value.get(port.bitName) ?? null
}

function compatiblePins(port: SignalCatalogEntry) {
  if (port.direction === 'output') {
    return compatiblePinGroups.value.output
  }

  if (port.direction === 'inout') {
    return [...compatiblePinGroups.value.input, ...compatiblePinGroups.value.output]
  }

  if (isLikelyClockPort(port.bitName)) {
    return [...compatiblePinGroups.value.clock, ...compatiblePinGroups.value.input]
  }

  return [...compatiblePinGroups.value.input, ...compatiblePinGroups.value.clock]
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
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">{{ t('pinPlanning') }}</h2>
        <p class="text-muted-foreground">
          {{ t('pinPlanningDescription', { top: topModule || 'top' }) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant="outline">{{ t('topModuleHint', { name: topModule }) }}</Badge>
        <Badge variant="outline">{{ boardDescriptor.displayName }}</Badge>
        <Badge variant="secondary">{{ projectStore.targetDeviceId }}</Badge>
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
      <Card>
        <CardHeader class="space-y-4">
          <div>
            <CardTitle>{{ t('pinAssignments') }}</CardTitle>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ t('pinAssignmentsDescription') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{{ designContextStore.sourceName.value }}</Badge>
            <Badge variant="secondary">{{ t('topModuleHint', { name: topModule }) }}</Badge>
            <Badge v-if="pinConflicts.size > 0" variant="destructive">
              {{ t('conflicts') }}: {{ pinConflicts.size }}
            </Badge>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" @click="autoAssignPins">
              {{ t('autoAssign') }}
            </Button>
            <Button type="button" variant="outline" @click="clearAssignments">
              {{ t('clearAll') }}
            </Button>
            <Button type="button" @click="exportXml">
              {{ t('exportConstraintXml') }}
            </Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <p v-if="exportMessage" class="text-sm text-muted-foreground">{{ exportMessage }}</p>
          <ScrollArea class="h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('direction') }}</TableHead>
                  <TableHead>{{ t('portName') }}</TableHead>
                  <TableHead>{{ t('pin') }}</TableHead>
                  <TableHead>{{ t('status') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="port in expandedPorts" :key="port.bitName">
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
                      :value="rowAssignment(port)?.pinId ?? UNASSIGNED_PIN"
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
                      v-if="
                        rowAssignment(port)?.pinId && pinConflicts.has(rowAssignment(port)!.pinId)
                      "
                      class="text-sm font-medium text-destructive"
                    >
                      {{ t('pinConflict') }}
                    </span>
                    <span v-else-if="rowAssignment(port)?.pinId" class="text-sm text-emerald-600">
                      {{ t('mapped') }}
                    </span>
                    <span v-else class="text-sm text-muted-foreground">{{ t('unbound') }}</span>
                  </TableCell>
                </TableRow>
                <TableEmpty v-if="expandedPorts.length === 0" :colspan="4">
                  {{ t('noTopPortsAvailable') }}
                </TableEmpty>
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
