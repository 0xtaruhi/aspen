<template>
  <Drawer v-model:open="innerOpen">
    <DrawerTrigger as-child>
      <slot name="trigger" />
    </DrawerTrigger>
    <DrawerContent :side="side" class="max-w-sm w-full">
      <DrawerHeader>
        <DrawerTitle>{{ title }}</DrawerTitle>
        <DrawerDescription v-if="description">{{ description }}</DrawerDescription>
      </DrawerHeader>
      <div class="p-4">
        <slot />
      </div>
      <DrawerFooter>
        <slot name="footer">
          <DrawerClose as-child>
            <button
              class="text-sm px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </DrawerClose>
        </slot>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'

type Props = {
  open?: boolean
  title: string
  description?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  description: '',
  side: 'right',
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const innerOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
})
</script>
