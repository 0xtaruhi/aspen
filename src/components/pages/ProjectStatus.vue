<script setup lang="ts">
import type { SynthesisCellTypeCountV1 } from '@/lib/hardware-client'

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import RecentProjectsPanel from '@/components/project/RecentProjectsPanel.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getFpgaDeviceDescriptor } from '@/lib/fpga-device-catalog'
import { useI18n } from '@/lib/i18n'
import { importProjectFiles, openProject } from '@/lib/project-io'
import { designContextStore } from '@/stores/design-context'
import { projectStore } from '@/stores/project'
import { synthesisCatalogStore } from '@/stores/synthesis-catalog'

const signalSummary = designContextStore.signalSummary
const activeFileName = designContextStore.sourceName
const router = useRouter()
const { t } = useI18n()
const targetDevice = computed(() => getFpgaDeviceDescriptor(projectStore.targetDeviceId))
const showNewProjectDialog = ref(false)
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))

function summarizeResources(counts: readonly SynthesisCellTypeCountV1[]) {
  let lut = 0
  let ff = 0
  let bram = 0
  let dsp = 0

  for (const entry of counts) {
    const cellType = entry.cell_type.toUpperCase()

    if (/^LUT\d+$/.test(cellType)) {
      lut += entry.count
      continue
    }

    if (/DFF|EDFF|LATCH/.test(cellType)) {
      ff += entry.count
      continue
    }

    if (/BRAM|BLOCKRAM|RAM/.test(cellType)) {
      bram += entry.count
      continue
    }

    if (/DSP|MULT|MAC/.test(cellType)) {
      dsp += entry.count
    }
  }

  return { lut, ff, bram, dsp }
}

const synthesizedResources = computed(() => {
  return summarizeResources(
    synthesisCatalogStore.currentSuccessfulSynthesisReport.value?.stats.cell_type_counts ?? [],
  )
})

const hasCurrentSynthesis = synthesisCatalogStore.hasCurrentSuccessfulSynthesisReport

const summaryCards = computed(() => {
  return [
    {
      title: t('lut4Count'),
      value: synthesizedResources.value.lut.toLocaleString(),
      desc: `${synthesizedResources.value.lut}/${targetDevice.value.resources.lut4}`,
    },
    {
      title: t('ffCount'),
      value: synthesizedResources.value.ff.toLocaleString(),
      desc: `${synthesizedResources.value.ff}/${targetDevice.value.resources.ff}`,
    },
    {
      title: t('bramCount'),
      value: synthesizedResources.value.bram.toLocaleString(),
      desc: `${synthesizedResources.value.bram}/${targetDevice.value.resources.bramBlocks}`,
    },
    {
      title: 'DSP',
      value: synthesizedResources.value.dsp.toLocaleString(),
      desc: t('dspUnavailable'),
    },
  ]
})

const resourceBars = computed(() => {
  return [
    {
      label: 'LUT',
      height: Math.max(
        0,
        Math.round((synthesizedResources.value.lut / targetDevice.value.resources.lut4) * 100),
      ),
      description: `${synthesizedResources.value.lut}/${targetDevice.value.resources.lut4}`,
      colorClass: 'bg-chart-1',
    },
    {
      label: 'FF',
      height: Math.max(
        0,
        Math.round((synthesizedResources.value.ff / targetDevice.value.resources.ff) * 100),
      ),
      description: `${synthesizedResources.value.ff}/${targetDevice.value.resources.ff}`,
      colorClass: 'bg-chart-2',
    },
    {
      label: 'BRAM',
      height: Math.max(
        0,
        Math.round(
          (synthesizedResources.value.bram / targetDevice.value.resources.bramBlocks) * 100,
        ),
      ),
      description: `${synthesizedResources.value.bram}/${targetDevice.value.resources.bramBlocks}`,
      colorClass: 'bg-chart-3',
    },
    {
      label: 'DSP',
      height: synthesizedResources.value.dsp > 0 ? 100 : 0,
      description: synthesizedResources.value.dsp.toLocaleString(),
      colorClass: 'bg-chart-4',
    },
  ]
})

function openSynthesis() {
  void router.push('/fpga-flow/synthesis')
}
</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">{{ t('projectStatus') }}</h2>
        <p class="text-muted-foreground">{{ t('projectStatusDescription') }}</p>
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

    <div v-else-if="hasCurrentSynthesis" class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card v-for="stat in summaryCards" :key="stat.title">
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">{{ stat.title }}</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stat.value }}</div>
          <p class="text-xs text-muted-foreground">
            {{ stat.desc }}
          </p>
        </CardContent>
      </Card>
    </div>

    <Card v-else class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ t('noSynthesisResults') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ t('noSynthesisResultsDescription') }}
        </p>
        <div class="flex flex-wrap gap-3">
          <Button type="button" @click="openSynthesis">
            {{ t('runSynthesis') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <div
      v-if="projectStore.hasProject && hasDesignSource && hasCurrentSynthesis"
      class="grid gap-4 lg:grid-cols-7"
    >
      <Card class="lg:col-span-4">
        <CardHeader>
          <CardTitle>{{ t('resourceUtilization') }}</CardTitle>
        </CardHeader>
        <CardContent class="pl-2">
          <div class="h-[200px] flex items-end justify-around p-4 gap-2">
            <div
              v-for="resource in resourceBars"
              :key="resource.label"
              class="w-full bg-muted h-full rounded-t relative group"
            >
              <div
                class="absolute bottom-0 w-full rounded-t opacity-80"
                :class="resource.colorClass"
                :style="{ height: `${resource.height}%` }"
              ></div>
              <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">
                {{ resource.label }}
              </span>
              <span
                class="absolute top-2 left-1/2 w-max -translate-x-1/2 rounded bg-background/90 px-2 py-1 text-[10px] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
              >
                {{ resource.description }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card class="lg:col-span-3">
        <CardHeader>
          <CardTitle>{{ t('recentActivity') }}</CardTitle>
          <CardDescription>{{ t('recentActivityDescription') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div class="flex items-center">
              <span class="relative flex h-2 w-2 mr-2">
                <span
                  class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
                ></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <div class="ml-2 space-y-1">
                <p class="text-sm font-medium leading-none">{{ t('designSourceAnalyzed') }}</p>
                <p class="text-xs text-muted-foreground">{{ activeFileName }}</p>
              </div>
            </div>
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-primary mr-2"></div>
              <div class="ml-2 space-y-1">
                <p class="text-sm font-medium leading-none">{{ t('signalSummaryReady') }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ t('inputs') }}: {{ signalSummary.inputs }} · {{ t('outputs') }}:
                  {{ signalSummary.outputs }} · {{ t('inouts') }}: {{ signalSummary.inouts }}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
