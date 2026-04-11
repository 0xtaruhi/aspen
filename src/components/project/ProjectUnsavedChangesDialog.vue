<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import {
  cancelProjectUnsavedChanges,
  projectUnsavedChangesStore,
  submitProjectUnsavedChanges,
} from '@/stores/project-unsaved-changes'

const { t } = useI18n()

function handleOpenChange(open: boolean) {
  if (!open) {
    cancelProjectUnsavedChanges()
  }
}
</script>

<template>
  <Dialog :open="projectUnsavedChangesStore.open" @update:open="handleOpenChange">
    <DialogContent :show-close-button="false" class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{{ projectUnsavedChangesStore.title }}</DialogTitle>
        <DialogDescription>
          {{ projectUnsavedChangesStore.description }}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2 sm:justify-end">
        <Button type="button" @click="submitProjectUnsavedChanges('save')">
          {{ t('saveProject') }}
        </Button>
        <Button type="button" variant="destructive" @click="submitProjectUnsavedChanges('discard')">
          {{ t('dontSave') }}
        </Button>
        <Button type="button" variant="outline" @click="cancelProjectUnsavedChanges">
          {{ t('cancel') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
