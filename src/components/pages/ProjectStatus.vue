<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Activity, Cpu, Clock, AlertCircle } from 'lucide-vue-next'

const stats = [
  { title: 'Device Utilization', value: '45%', icon: Cpu, desc: 'LUTs: 1240/5000' },
  { title: 'Power Estimate', value: '1.2W', icon: Activity, desc: 'Dynamic: 0.8W' },
  { title: 'Worst Negative Slack', value: '0.4ns', icon: Clock, desc: 'Met Timing' },
  { title: 'Critical Warnings', value: '0', icon: AlertCircle, desc: 'Clean Build' },
]
</script>

<template>
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div>
      <h2 class="text-3xl font-bold tracking-tight">Project Status</h2>
      <p class="text-muted-foreground">Overview of your FPGA design metrics.</p>
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
          <!-- Mock Chart Placeholder -->
          <div class="h-[200px] flex items-end justify-around p-4 gap-2">
             <div class="w-full bg-blue-500/20 h-[45%] rounded-t relative group">
                <div class="absolute bottom-0 w-full bg-blue-500 h-full rounded-t opacity-80"></div>
                <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">LUT</span>
             </div>
             <div class="w-full bg-green-500/20 h-[30%] rounded-t relative group">
                <div class="absolute bottom-0 w-full bg-green-500 h-full rounded-t opacity-80"></div>
                <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">FF</span>
             </div>
             <div class="w-full bg-yellow-500/20 h-[10%] rounded-t relative group">
                <div class="absolute bottom-0 w-full bg-yellow-500 h-full rounded-t opacity-80"></div>
                <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">BRAM</span>
             </div>
             <div class="w-full bg-purple-500/20 h-[5%] rounded-t relative group">
                <div class="absolute bottom-0 w-full bg-purple-500 h-full rounded-t opacity-80"></div>
                <span class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs">DSP</span>
             </div>
          </div>
        </CardContent>
      </Card>
      <Card class="col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            Latest build and simulation runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div class="flex items-center">
              <span class="relative flex h-2 w-2 mr-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <div class="ml-2 space-y-1">
                <p class="text-sm font-medium leading-none">Synthesis Completed</p>
                <p class="text-xs text-muted-foreground">2 minutes ago</p>
              </div>
            </div>
             <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-blue-500 mr-2"></div>
              <div class="ml-2 space-y-1">
                <p class="text-sm font-medium leading-none">Simulation Passed</p>
                <p class="text-xs text-muted-foreground">1 hour ago</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
