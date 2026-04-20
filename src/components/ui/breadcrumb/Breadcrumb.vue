<script lang="ts" setup>
import type { HTMLAttributes } from 'vue'

import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { t } = useI18n()
</script>

<template>
  <nav :aria-label="t('breadcrumb')" data-slot="breadcrumb" :class="props.class">
    <slot />
  </nav>
</template>
