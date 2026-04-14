<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { FolderOpen, FilePlus2, X } from 'lucide-vue-next'

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
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import { createProjectAtDirectory, PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS } from '@/lib/project-io'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const projectName = ref(t('projectNameDefault'))
const projectTemplate = ref<'empty' | 'blinky' | 'uart'>('empty')
const projectParentDirectory = ref('')
const importedSourcePaths = ref<string[]>([])
const isCreating = ref(false)

const canCreate = computed(() => {
  return (
    projectName.value.trim().length > 0 &&
    projectParentDirectory.value.trim().length > 0 &&
    !isCreating.value
  )
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return
    }

    projectName.value = t('projectNameDefault')
    projectTemplate.value = 'empty'
    projectParentDirectory.value = ''
    importedSourcePaths.value = []
    isCreating.value = false
  },
)

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path
}

async function chooseProjectParentDirectory() {
  const selected = await openDialog({
    directory: true,
    multiple: false,
  })

  if (typeof selected !== 'string') {
    return
  }

  projectParentDirectory.value = selected
}

async function chooseImportSources() {
  const selected = await openDialog({
    multiple: true,
    filters: [
      {
        name: t('sourceFiles'),
        extensions: [...PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS],
      },
    ],
  })

  const selectedPaths =
    typeof selected === 'string' ? [selected] : Array.isArray(selected) ? selected : []

  if (selectedPaths.length === 0) {
    return
  }

  importedSourcePaths.value = selectedPaths
}

function removeImportedSource(path: string) {
  importedSourcePaths.value = importedSourcePaths.value.filter((entry) => entry !== path)
}

async function handleCreate() {
  if (!canCreate.value) {
    return
  }

  isCreating.value = true
  try {
    const created = await createProjectAtDirectory({
      name: projectName.value,
      template: projectTemplate.value,
      parentDirectoryPath: projectParentDirectory.value,
      importPaths: importedSourcePaths.value,
    })

    if (created) {
      emit('update:open', false)
    }
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>{{ t('createNewProject') }}</DialogTitle>
        <DialogDescription>
          {{ t('createNewProjectDescription') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-5 py-2">
        <div class="space-y-2">
          <Label for="project-name">{{ t('name') }}</Label>
          <Input id="project-name" v-model="projectName" />
        </div>

        <div class="space-y-2">
          <Label>{{ t('projectLocation') }}</Label>
          <div class="flex gap-2">
            <Input
              :model-value="projectParentDirectory"
              readonly
              :placeholder="t('projectLocationPlaceholder')"
            />
            <Button
              type="button"
              variant="outline"
              class="shrink-0 gap-2"
              @click="chooseProjectParentDirectory"
            >
              <FolderOpen class="size-4" />
              {{ t('chooseFolder') }}
            </Button>
          </div>
          <p class="text-sm text-muted-foreground">
            {{
              t('projectDirectoryWillBeCreated', { name: projectName || t('projectNameDefault') })
            }}
          </p>
        </div>

        <div class="space-y-2">
          <Label for="project-template">{{ t('template') }}</Label>
          <Select v-model="projectTemplate">
            <SelectTrigger id="project-template">
              <SelectValue :placeholder="t('selectTemplate')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">{{ t('emptyProject') }}</SelectItem>
              <SelectItem value="blinky">{{ t('ledBlinky') }}</SelectItem>
              <SelectItem value="uart">{{ t('uartEcho') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="space-y-1">
              <Label>{{ t('importSourceFilesOptional') }}</Label>
              <p class="text-sm text-muted-foreground">
                {{ t('importSourceFilesOptionalDescription') }}
              </p>
            </div>
            <Button type="button" variant="outline" class="gap-2" @click="chooseImportSources">
              <FilePlus2 class="size-4" />
              {{ t('chooseSourceFiles') }}
            </Button>
          </div>

          <div
            v-if="importedSourcePaths.length > 0"
            class="rounded-lg border border-border/60 bg-muted/30 p-3"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-sm font-medium">{{ t('importedSourceFiles') }}</span>
              <Badge variant="secondary">{{ importedSourcePaths.length }}</Badge>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="path in importedSourcePaths"
                :key="path"
                type="button"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-xs"
                @click="removeImportedSource(path)"
              >
                <span class="truncate">{{ basename(path) }}</span>
                <X class="size-3 shrink-0 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isCreating" @click="$emit('update:open', false)">
          {{ t('cancel') }}
        </Button>
        <Button type="submit" :disabled="!canCreate" @click="handleCreate">
          {{ isCreating ? t('creatingProject') : t('createProject') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
