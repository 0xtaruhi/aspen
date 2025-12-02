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
import { projectStore } from '@/stores/project'

defineProps<{
    open: boolean
}>()

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void
}>()

const projectName = ref('MyFPGAProject')
const projectLocation = ref('/Users/zhangzhengyi/Documents/Projects')
const projectTemplate = ref('empty')

function handleCreate() {
    // In a real app, this would call a backend API
    // For now, we just simulate creating a new project in the store
    projectStore.createNewProject(projectName.value, projectTemplate.value)
    emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogDescription>
          Set up your new FPGA project. Click create when you're done.
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="name" class="text-right">
            Name
          </Label>
          <Input id="name" v-model="projectName" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="location" class="text-right">
            Location
          </Label>
          <Input id="location" v-model="projectLocation" class="col-span-3" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="template" class="text-right">
            Template
          </Label>
          <Select v-model="projectTemplate">
            <SelectTrigger class="col-span-3">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">Empty Project</SelectItem>
              <SelectItem value="blinky">LED Blinky</SelectItem>
              <SelectItem value="uart">UART Echo</SelectItem>
              <SelectItem value="riscv">RISC-V Softcore</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">Cancel</Button>
        <Button type="submit" @click="handleCreate">Create Project</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
