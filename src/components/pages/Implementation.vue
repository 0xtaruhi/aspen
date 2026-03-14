<script setup lang="ts">
import { computed } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { designContextStore } from '@/stores/design-context'

type TimingPath = {
  name: string
  slack: string
  levels: number
  skew: string
}

const outputSignals = designContextStore.outputSignals
const sourceLines = designContextStore.codeLines

const timingPaths = computed<TimingPath[]>(() => {
  if (outputSignals.value.length === 0) {
    return []
  }

  return outputSignals.value.slice(0, 5).map((signal, index) => {
    const slack = (1.35 - index * 0.22 - signal.name.length * 0.03).toFixed(3)
    const levels = Math.max(2, Math.min(18, Math.round(sourceLines.value / 18) + index * 2))
    const skew = (0.005 + index * 0.006).toFixed(3)
    return {
      name: `clk -> ${signal.name}`,
      slack,
      levels,
      skew,
    }
  })
})

const worstSlack = computed(() => {
  if (timingPaths.value.length === 0) {
    return 'N/A'
  }

  return timingPaths.value.reduce((min, path) => {
    return Number(path.slack) < Number(min) ? path.slack : min
  }, timingPaths.value[0].slack)
})

const dynamicPower = computed(() => {
  const value = sourceLines.value * 0.005 + outputSignals.value.length * 0.06
  return value.toFixed(3)
})

const staticPower = computed(() => {
  return (0.42 + Math.max(0, sourceLines.value - 20) * 0.0008).toFixed(3)
})

const totalPower = computed(() => {
  return (Number(dynamicPower.value) + Number(staticPower.value)).toFixed(3)
})
</script>

<template>
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Implementation</h2>
        <p class="text-muted-foreground">
          Place & Route results and timing analysis for {{ designContextStore.sourceName.value }}.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant="secondary"
          >WNS: {{ worstSlack === 'N/A' ? 'N/A' : `${worstSlack}ns` }}</Badge
        >
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Floorplan Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            class="aspect-video bg-muted rounded-md border border-border relative overflow-hidden grid grid-cols-12 grid-rows-8 gap-px p-4"
          >
            <div
              v-for="i in 96"
              :key="i"
              class="bg-muted-foreground/10 rounded-sm"
              :class="{ 'bg-chart-1/40': i % 7 === 0, 'bg-chart-2/40': i % 13 === 0 }"
            ></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Power Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Total Power</span>
              <span class="font-bold">{{ totalPower }} W</span>
            </div>
            <div class="h-2 bg-muted rounded-full overflow-hidden flex">
              <div
                class="h-full bg-chart-5"
                :style="{ width: `${(Number(dynamicPower) / Number(totalPower)) * 100}%` }"
                title="Dynamic"
              ></div>
              <div
                class="h-full bg-chart-1"
                :style="{ width: `${(Number(staticPower) / Number(totalPower)) * 100}%` }"
                title="Static"
              ></div>
            </div>
            <div class="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-chart-5"></div>
                <span>Dynamic: {{ dynamicPower }} W</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-chart-1"></div>
                <span>Static: {{ staticPower }} W</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Timing Summary (Top 3 Critical Paths)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Path Name</TableHead>
              <TableHead>Slack (ns)</TableHead>
              <TableHead>Logic Levels</TableHead>
              <TableHead>Clock Skew</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="path in timingPaths" :key="path.name">
              <TableCell class="font-mono text-xs">{{ path.name }}</TableCell>
              <TableCell
                :class="Number(path.slack) < 0 ? 'text-red-500 font-bold' : 'text-green-500'"
                >{{ path.slack }}</TableCell
              >
              <TableCell>{{ path.levels }}</TableCell>
              <TableCell>{{ path.skew }}</TableCell>
            </TableRow>
            <TableEmpty v-if="timingPaths.length === 0" :colspan="4" class="text-muted-foreground">
              No output signals found in selected design source.
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
