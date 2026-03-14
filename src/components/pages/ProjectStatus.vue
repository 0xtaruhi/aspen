<script setup lang="ts">
import { computed } from 'vue'
import { Activity, AlertCircle, Clock, Cpu } from 'lucide-vue-next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { designContextStore } from '@/stores/design-context'

const codeLines = designContextStore.codeLines
const signalSummary = designContextStore.signalSummary
const activeFileName = designContextStore.sourceName

const estimatedResources = computed(() => {
  const lut = Math.max(64, codeLines.value * 3 + signalSummary.value.outputs * 20)
  const ff = Math.max(32, codeLines.value * 2 + signalSummary.value.inputs * 16)
  const bram = Math.max(1, Math.ceil(codeLines.value / 180))
  const dsp = Math.max(0, Math.ceil(signalSummary.value.outputs / 3))
  return { lut, ff, bram, dsp }
})

const utilizationPercent = computed(() => {
  const cap = 5000
  return Math.min(99, Math.round((estimatedResources.value.lut / cap) * 100))
})

const estimatedPower = computed(() => {
  const dynamic = estimatedResources.value.lut * 0.00042 + estimatedResources.value.ff * 0.00018
  const staticPower = 0.42
  return {
    total: (dynamic + staticPower).toFixed(2),
    dynamic: dynamic.toFixed(2),
  }
})

const estimatedWns = computed(() => {
  const signalWeight = signalSummary.value.outputs + signalSummary.value.inputs * 0.5
  return (1.6 - Math.min(1.4, signalWeight * 0.08)).toFixed(3)
})

const stats = computed(() => [
  {
    title: 'Device Utilization',
    value: `${utilizationPercent.value}%`,
    icon: Cpu,
    desc: `LUTs: ${estimatedResources.value.lut}/5000 (estimated)`,
  },
  {
    title: 'Power Estimate',
    value: `${estimatedPower.value.total}W`,
    icon: Activity,
    desc: `Dynamic: ${estimatedPower.value.dynamic}W`,
  },
  {
    title: 'Worst Negative Slack',
    value: `${estimatedWns.value}ns`,
    icon: Clock,
    desc: Number(estimatedWns.value) >= 0 ? 'Timing estimated as met' : 'Timing risk detected',
  },
  {
    title: 'Critical Warnings',
    value: signalSummary.value.outputs > 0 ? '0' : '1',
    icon: AlertCircle,
    desc: signalSummary.value.outputs > 0 ? 'No obvious output issues' : 'No output signal found',
  },
])

const resourceBars = computed(() => {
  const maxValue = Math.max(
    estimatedResources.value.lut,
    estimatedResources.value.ff,
    estimatedResources.value.bram * 200,
    Math.max(1, estimatedResources.value.dsp) * 150,
  )

  return [
    {
      label: 'LUT',
      height: Math.max(8, Math.round((estimatedResources.value.lut / maxValue) * 100)),
      colorClass: 'bg-chart-1',
    },
    {
      label: 'FF',
      height: Math.max(8, Math.round((estimatedResources.value.ff / maxValue) * 100)),
      colorClass: 'bg-chart-2',
    },
    {
      label: 'BRAM',
      height: Math.max(8, Math.round(((estimatedResources.value.bram * 200) / maxValue) * 100)),
      colorClass: 'bg-chart-3',
    },
    {
      label: 'DSP',
      height: Math.max(
        8,
        Math.round(((Math.max(1, estimatedResources.value.dsp) * 150) / maxValue) * 100),
      ),
      colorClass: 'bg-chart-4',
    },
  ]
})
</script>

<template>
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Project Status</h2>
        <p class="text-muted-foreground">Overview of your selected FPGA design metrics.</p>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card v-for="stat in stats" :key="stat.title">
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">
            {{ stat.title }}
          </CardTitle>
          <component :is="stat.icon" class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stat.value }}</div>
          <p class="text-xs text-muted-foreground">
            {{ stat.desc }}
          </p>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
      <Card class="col-span-4">
        <CardHeader>
          <CardTitle>Resource Utilization</CardTitle>
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
              <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">{{
                resource.label
              }}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card class="col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest build and simulation runs.</CardDescription>
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
                <p class="text-sm font-medium leading-none">Design source analyzed</p>
                <p class="text-xs text-muted-foreground">{{ activeFileName }}</p>
              </div>
            </div>
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-primary mr-2"></div>
              <div class="ml-2 space-y-1">
                <p class="text-sm font-medium leading-none">Signal summary ready</p>
                <p class="text-xs text-muted-foreground">
                  Inputs: {{ signalSummary.inputs }} · Outputs: {{ signalSummary.outputs }} ·
                  Inouts: {{ signalSummary.inouts }}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
