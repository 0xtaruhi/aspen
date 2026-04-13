<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

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
import { Label } from '@/components/ui/label'
import { useI18n } from '@/lib/i18n'
import {
  cancelProjectTextInput,
  projectTextInputStore,
  submitProjectTextInput,
} from '@/stores/project-text-input'

type InputHandle = {
  focus: () => void
  select: () => void
}

const { t } = useI18n()
const inputRef = ref<InputHandle | null>(null)

const isSubmitDisabled = computed(() => {
  return projectTextInputStore.value.trim().length === 0
})

function handleOpenChange(open: boolean) {
  if (!open) {
    cancelProjectTextInput()
  }
}

function handleSubmit() {
  submitProjectTextInput()
}

watch(
  () => projectTextInputStore.open,
  async (open) => {
    if (!open) {
      return
    }

    await nextTick()
    window.requestAnimationFrame(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    })
  },
)
</script>

<template>
  <Dialog :open="projectTextInputStore.open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[425px]">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <DialogHeader>
          <DialogTitle>{{ projectTextInputStore.title }}</DialogTitle>
          <DialogDescription v-if="projectTextInputStore.description">
            {{ projectTextInputStore.description }}
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-2">
          <Label for="project-text-input">{{ t('name') }}</Label>
          <Input id="project-text-input" ref="inputRef" v-model="projectTextInputStore.value" />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="cancelProjectTextInput">
            {{ t('cancel') }}
          </Button>
          <Button type="submit" :disabled="isSubmitDisabled">
            {{ projectTextInputStore.confirmLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
