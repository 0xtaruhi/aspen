<script setup lang="ts">
import { useRouter } from 'vue-router'

import NetlistExplorer from '@/components/synthesis/NetlistExplorer.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'

const router = useRouter()
const { t } = useI18n()

const synthesisReport = hardwareStore.synthesisReport
const synthesisRunning = hardwareStore.synthesisRunning
const implementationReport = hardwareStore.implementationReport

function openSynthesisPage() {
  void router.push({ name: 'fpga-flow-synthesis' })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background animate-in fade-in duration-500">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/20 px-4">
      <Button type="button" size="sm" variant="outline" @click="openSynthesisPage">
        {{ t('synthesis') }}
      </Button>

      <div class="flex items-center gap-2 ml-auto">
        <Badge v-if="synthesisReport" variant="outline">
          {{ t('topModuleHint', { name: synthesisReport.top_module }) }}
        </Badge>
        <Badge v-if="synthesisRunning" variant="outline">
          {{ t('running') }}
        </Badge>
      </div>
    </div>

    <NetlistExplorer
      :report="synthesisReport"
      :implementation-report="implementationReport"
      :busy="synthesisRunning"
    />
  </div>
</template>
