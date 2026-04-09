<script setup lang="ts">
import { X } from 'lucide-vue-next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import DeviceManual from '@/components/virtual-device/DeviceManual.vue'
import { useI18n } from '@/lib/i18n'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

const props = defineProps<{
  open: boolean
  device: CanvasDeviceSnapshot | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <Dialog :open="props.open" @update:open="(open) => (!open ? emit('close') : null)">
    <DialogScrollContent
      :show-close-button="false"
      class="h-[90vh] max-h-[90vh] border-border/80 bg-background/98 p-0 sm:max-w-[1100px]"
    >
      <div class="flex h-full min-h-0 flex-col">
        <Button
          variant="outline"
          size="icon"
          class="absolute top-4 right-4 z-20 rounded-full bg-background/95 shadow-sm backdrop-blur"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </Button>

        <div class="border-b border-border/70 px-6 py-5">
          <div class="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {{ props.device?.type }}
          </div>
          <DialogTitle class="mt-2 text-xl font-semibold">
            {{ props.device?.label }} · {{ t('manual') }}
          </DialogTitle>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <DeviceManual v-if="props.device" :device="props.device" />
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
