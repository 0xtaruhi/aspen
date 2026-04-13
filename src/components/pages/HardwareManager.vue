<script setup lang="ts">
import {
  Server,
  Cpu,
  RefreshCw,
  Plug,
  Play,
  CheckCircle2,
  FileCode,
  XCircle,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useHardwareManagerState } from '@/lib/hardware-manager'

const {
  autoConnect,
  bitstreamFile,
  canOpenProgramDialog,
  canProgram,
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
  openProgramDialog,
  pickBitstream,
  programDevice,
  programMessage,
  programMessageTone,
  refreshStatus,
  selectedDevice,
  selectedTargetId,
  showToolbarFlowBadge,
  targets,
  t,
} = useHardwareManagerState()
</script>

<template>
  <div class="h-full flex flex-col bg-transparent">
    <!-- Toolbar -->
    <div class="app-toolbar-glass h-12 flex items-center px-4 gap-2">
      <Button variant="outline" size="sm" class="gap-2" :disabled="isBusy" @click="autoConnect">
        <Plug class="w-4 h-4" />
        {{ isConnecting ? t('connectingEllipsis') : t('autoConnect') }}
      </Button>

      <Button
        v-if="hardwareStatus"
        variant="ghost"
        size="sm"
        class="gap-2 text-destructive hover:text-destructive"
        @click="disconnect"
      >
        <XCircle class="w-4 h-4" />
        {{ t('disconnectHardware') }}
      </Button>

      <Separator orientation="vertical" class="h-6 mx-2" />

      <Button
        variant="ghost"
        size="icon"
        :title="t('refreshTargets')"
        :disabled="isBusy"
        @click="refreshStatus"
      >
        <RefreshCw class="w-4 h-4" :class="isConnecting ? 'animate-spin' : ''" />
      </Button>

      <Button size="sm" class="gap-2" :disabled="!canOpenProgramDialog" @click="openProgramDialog">
        <Play class="w-4 h-4" />
        {{ t('programDeviceShort') }}
      </Button>

      <span v-if="hotplugLog" class="text-xs text-muted-foreground ml-auto">
        {{ hotplugLog }}
      </span>

      <Badge v-if="showToolbarFlowBadge" variant="outline" class="ml-2" :class="flowBadgeClass">
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
        <ResizablePanel :default-size="25" :min-size="20" class="bg-muted/10">
          <div class="p-2 font-medium text-xs text-muted-foreground uppercase tracking-wider mb-2">
            {{ t('hardwareTargets') }}
          </div>
          <ScrollArea class="h-full">
            <div
              v-if="targets.length === 0"
              class="p-4 text-sm text-muted-foreground text-center italic"
            >
              {{ t('noHardwareTargetsOpen') }} <br />
              {{ t('clickAutoConnectToStart') }}
            </div>
            <div v-else class="px-2 space-y-1">
              <div v-for="server in targets" :key="server.id">
                <div
                  class="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer text-sm font-medium"
                >
                  <Server class="w-4 h-4 text-blue-500" />
                  {{ server.name }}
                  <Badge variant="outline" class="ml-auto text-[10px] h-5">
                    {{ t('connected') }}
                  </Badge>
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

        <ResizableHandle class="bg-border/45" />

        <!-- Device Details & Operations -->
        <ResizablePanel :default-size="75" class="bg-transparent p-0">
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
                      : !hardwareStatus?.config.pcb_connected
                        ? 'text-muted-foreground'
                        : ''
                  "
                >
                  <CheckCircle2 class="w-3 h-3 mr-1" />
                  {{
                    !hardwareStatus?.config.pcb_connected
                      ? t('disconnected')
                      : hardwareStatus?.config.programmed
                        ? t('programmed')
                        : t('detected')
                  }}
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

              <p
                v-if="programMessage"
                class="text-sm"
                :class="programMessageTone === 'error' ? 'text-destructive' : 'text-green-600'"
              >
                {{ programMessage }}
              </p>
            </div>
            <div
              v-else
              class="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4"
            >
              <div class="p-4 bg-muted/30 rounded-full">
                <Cpu class="w-12 h-12 opacity-50" />
              </div>
              <p>{{ t('selectHardwareDeviceToViewDetails') }}</p>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>

    <Dialog :open="isProgramDialogOpen" @update:open="isProgramDialogOpen = $event">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{{ t('programDeviceTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('programDeviceDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="grid gap-1.5">
            <label
              for="bitstream"
              class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {{ t('bitstreamFile') }}
            </label>
            <div class="flex w-full items-center gap-2">
              <div class="relative flex-1">
                <FileCode class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="bitstream"
                  v-model="bitstreamFile"
                  placeholder="/path/to/project.bit"
                  class="pl-9"
                />
              </div>
              <Button variant="secondary" type="button" :disabled="isBusy" @click="pickBitstream">
                {{ t('browse') }}
              </Button>
            </div>
          </div>

          <div class="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              {{ t('defaultLabel') }}
            </p>
            <p class="mt-2 break-all font-mono text-sm text-foreground/90">
              {{ defaultBitstreamPath || t('noCurrentProjectBitstreamPath') }}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="isProgramDialogOpen = false">{{ t('cancel') }}</Button>
          <Button :disabled="!canProgram" @click="programDevice">
            <Play v-if="!isProgramming" class="mr-2 h-4 w-4" />
            {{ isProgramming ? t('programmingEllipsis') : t('program') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
