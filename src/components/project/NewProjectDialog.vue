<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Blocks, FileCode2, FilePlus2, FolderOpen, X } from '@lucide/vue'

import type { ProjectStarterCatalogEntry } from '@/lib/project-starters'

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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/lib/i18n'
import { createProjectAtDirectory, PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS } from '@/lib/project-io'
import { defaultProjectStarter, projectStarterCatalog } from '@/lib/project-starters'

import ProjectStarterCard from './ProjectStarterCard.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const projectName = ref(t('projectNameDefault'))
const selectedStarterId = ref(defaultProjectStarter.id)
const starterSection = ref<'templates' | 'examples'>('templates')
const projectNameCustomized = ref(false)
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

const templateStarters = computed(() =>
  projectStarterCatalog.filter((entry) => entry.category === 'template'),
)
const deviceLabStarters = computed(() =>
  projectStarterCatalog.filter((entry) => entry.category === 'device-lab'),
)
const showcaseStarters = computed(() =>
  projectStarterCatalog.filter((entry) => entry.category === 'showcase'),
)
const selectedStarter = computed(
  () =>
    projectStarterCatalog.find((entry) => entry.id === selectedStarterId.value) ??
    defaultProjectStarter,
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return
    }

    projectName.value = t('projectNameDefault')
    selectedStarterId.value = defaultProjectStarter.id
    starterSection.value = 'templates'
    projectNameCustomized.value = false
    projectParentDirectory.value = ''
    importedSourcePaths.value = []
    isCreating.value = false
  },
)

function updateProjectName(value: string | number) {
  projectName.value = String(value)
  projectNameCustomized.value = true
}

function selectStarter(entry: ProjectStarterCatalogEntry) {
  selectedStarterId.value = entry.id
  if (!projectNameCustomized.value) {
    projectName.value = entry.suggestedName
  }
}

function selectStarterSection(section: 'templates' | 'examples') {
  starterSection.value = section
  const visibleStarters = section === 'templates' ? templateStarters.value : deviceLabStarters.value
  if (!visibleStarters.some((entry) => entry.id === selectedStarterId.value)) {
    selectStarter(visibleStarters[0] ?? defaultProjectStarter)
  }
}

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
      starter: selectedStarter.value.starter,
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
    <DialogContent
      class="grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-[900px]"
      :class="
        starterSection === 'examples'
          ? 'h-[min(860px,calc(100vh-2rem))]'
          : 'h-[min(640px,calc(100vh-2rem))]'
      "
    >
      <DialogHeader>
        <div class="border-b border-border/70 px-6 py-5 pr-14">
          <DialogTitle>{{ t('createNewProject') }}</DialogTitle>
          <DialogDescription class="mt-1.5">
            {{ t('createNewProjectDescription') }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <ScrollArea class="min-h-0">
        <div class="space-y-6 px-6 py-5 pr-8">
          <div class="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
            <div class="space-y-2">
              <Label for="project-name">{{ t('name') }}</Label>
              <Input
                id="project-name"
                :model-value="projectName"
                @update:model-value="updateProjectName"
              />
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
              <p class="text-xs text-muted-foreground">
                {{
                  t('projectDirectoryWillBeCreated', {
                    name: projectName || t('projectNameDefault'),
                  })
                }}
              </p>
            </div>
          </div>

          <section class="space-y-3" aria-labelledby="project-starter-label">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label id="project-starter-label">{{ t('startingPoint') }}</Label>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{
                    starterSection === 'templates'
                      ? t('starterTemplatesDescription')
                      : t('exampleProjectsDescription')
                  }}
                </p>
              </div>
              <div
                class="grid grid-cols-2 rounded-md border border-border/70 bg-muted/35 p-1"
                role="tablist"
                :aria-label="t('startingPoint')"
              >
                <button
                  type="button"
                  role="tab"
                  :aria-selected="starterSection === 'templates'"
                  class="inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    starterSection === 'templates'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="selectStarterSection('templates')"
                >
                  <FileCode2 class="size-3.5" />
                  {{ t('starterTemplates') }}
                  <span class="font-mono text-[10px] text-muted-foreground">03</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="starterSection === 'examples'"
                  class="inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    starterSection === 'examples'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="selectStarterSection('examples')"
                >
                  <Blocks class="size-3.5" />
                  {{ t('exampleProjects') }}
                  <span class="font-mono text-[10px] text-muted-foreground">12</span>
                </button>
              </div>
            </div>

            <div role="radiogroup" :aria-label="t('startingPoint')">
              <div v-if="starterSection === 'templates'" class="grid gap-3 md:grid-cols-3">
                <ProjectStarterCard
                  v-for="entry in templateStarters"
                  :key="entry.id"
                  :entry="entry"
                  :selected="entry.id === selectedStarterId"
                  @select="selectStarter"
                />
              </div>

              <div v-else class="space-y-5">
                <div class="space-y-2.5">
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-[10px] tracking-[0.18em] text-cyan-500 uppercase">
                      {{ t('deviceLabs') }}
                    </span>
                    <span class="h-px flex-1 bg-border/70" />
                  </div>
                  <div class="grid gap-3 md:grid-cols-3">
                    <ProjectStarterCard
                      v-for="entry in deviceLabStarters"
                      :key="entry.id"
                      :entry="entry"
                      :selected="entry.id === selectedStarterId"
                      @select="selectStarter"
                    />
                  </div>
                </div>

                <div class="space-y-2.5">
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-[10px] tracking-[0.18em] text-amber-500 uppercase">
                      {{ t('showcases') }}
                    </span>
                    <span class="h-px flex-1 bg-border/70" />
                  </div>
                  <div class="grid gap-3 md:grid-cols-3">
                    <ProjectStarterCard
                      v-for="entry in showcaseStarters"
                      :key="entry.id"
                      :entry="entry"
                      :selected="entry.id === selectedStarterId"
                      @select="selectStarter"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="space-y-3 border-t border-border/60 pt-5">
            <div class="flex items-center justify-between gap-3">
              <div class="space-y-1">
                <Label>{{ t('importSourceFilesOptional') }}</Label>
                <p class="text-xs text-muted-foreground">
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
      </ScrollArea>

      <DialogFooter class="border-t border-border/70 px-6 py-4">
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
