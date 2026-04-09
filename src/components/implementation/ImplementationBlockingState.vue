<script setup lang="ts">
import { CheckCircle2, TriangleAlert } from 'lucide-vue-next'

import RecentProjectsPanel from '@/components/project/RecentProjectsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'

import type {
  ImplementationBlockingStateViewModel,
  ImplementationReadinessChecklistItem,
} from './types'

const props = defineProps<{
  blockingState: ImplementationBlockingStateViewModel
  readinessChecklist: ImplementationReadinessChecklistItem[]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
    <Card>
      <CardHeader>
        <CardTitle>{{ props.blockingState.title }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-start gap-3 text-sm text-muted-foreground">
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>{{ props.blockingState.description }}</p>
        </div>

        <div class="flex flex-wrap gap-3">
          <Button
            v-for="action in props.blockingState.actions"
            :key="action.label"
            type="button"
            :variant="action.variant"
            @click="action.onClick()"
          >
            {{ action.label }}
          </Button>
        </div>

        <div v-if="props.blockingState.showRecentProjects" class="border-t border-border pt-4">
          <RecentProjectsPanel />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('implementation') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        <div
          v-for="item in props.readinessChecklist"
          :key="item.key"
          class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-3"
        >
          <div class="flex items-center gap-3">
            <CheckCircle2 v-if="item.ready" class="h-4 w-4 text-emerald-600" />
            <TriangleAlert v-else class="h-4 w-4 text-amber-600" />
            <div>
              <div class="text-sm font-medium">{{ item.label }}</div>
              <div class="text-xs text-muted-foreground">
                {{ item.ready ? t('completed') : t('pending') }}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            :class="
              item.ready
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-600'
            "
          >
            {{ item.ready ? t('ready') : t('pending') }}
          </Badge>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
