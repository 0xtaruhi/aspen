<script setup lang="ts">
import { ref } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { projectStore } from '@/stores/project'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const projectName = ref(t('projectNameDefault'))
const projectTemplate = ref<'empty' | 'blinky' | 'uart'>('empty')

function handleCreate() {
  projectStore.createNewProject(projectName.value, projectTemplate.value)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ t('createNewProject') }}</DialogTitle>
        <DialogDescription>
          {{ t('createNewProjectDescription') }}
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="name" class="text-right"> {{ t('name') }} </Label>
          <Input id="name" v-model="projectName" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="template" class="text-right"> {{ t('template') }} </Label>
          <Select v-model="projectTemplate">
            <SelectTrigger class="col-span-3">
              <SelectValue :placeholder="t('selectTemplate')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">{{ t('emptyProject') }}</SelectItem>
              <SelectItem value="blinky">{{ t('ledBlinky') }}</SelectItem>
              <SelectItem value="uart">{{ t('uartEcho') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">{{ t('cancel') }}</Button>
        <Button type="submit" @click="handleCreate">{{ t('createProject') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
