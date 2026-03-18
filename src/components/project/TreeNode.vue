<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CircuitBoard,
  Folder,
  FileCode,
  ChevronRight,
  ChevronDown,
  Plus,
  FolderPlus,
  Trash2,
  Edit2,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useI18n } from '@/lib/i18n'
import { extractVerilogModuleNames } from '@/lib/verilog-modules'
import { projectStore, type ProjectNode } from '@/stores/project'
import { requestProjectTextInput } from '@/stores/project-text-input'
import { settingsStore } from '@/stores/settings'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { confirmAction } from '@/lib/confirm-action'

const props = defineProps<{
  node: ProjectNode
}>()

const router = useRouter()
const { t } = useI18n()
const isTopModuleDialogOpen = ref(false)
const pendingTopModuleName = ref('')

const nodeModuleNames = computed(() => {
  if (props.node.type !== 'file' || !isHardwareSourceFile(props.node.name)) {
    return []
  }

  return extractVerilogModuleNames(props.node.content || '')
})

function isHardwareSourceFile(name: string) {
  return name.endsWith('.v') || name.endsWith('.sv')
}

function selectNode() {
  projectStore.setSelectedNode(props.node.id)
}

function toggleFolder() {
  if (props.node.type === 'folder') {
    selectNode()
    props.node.isOpen = !props.node.isOpen
  }
}

async function handleRename() {
  selectNode()
  const newName = await requestProjectTextInput({
    title: t('rename'),
    confirmLabel: t('rename'),
    initialValue: props.node.name,
  })
  if (!newName) {
    return
  }

  projectStore.renameNode(props.node.id, newName)
}

async function handleNewFile() {
  selectNode()
  const name = await requestProjectTextInput({
    title: t('newFile'),
    confirmLabel: t('newFile'),
    initialValue: 'new_file.v',
  })
  if (!name) {
    return
  }

  projectStore.createFile(props.node.id, name)
  void router.push({ name: 'project-management-editor' })
}

async function handleNewFolder() {
  selectNode()
  const name = await requestProjectTextInput({
    title: t('newFolder'),
    confirmLabel: t('newFolder'),
    initialValue: t('newFolder'),
  })
  if (!name) {
    return
  }

  projectStore.createFolder(props.node.id, name)
}

async function handleDelete() {
  if (
    !settingsStore.state.confirmDelete ||
    (await confirmAction(t('deleteFileConfirm', { name: props.node.name }), {
      title: t('deleteFileTitle'),
    }))
  ) {
    projectStore.deleteNode(props.node.id)
  }
}

function openFile(id: string) {
  projectStore.setActiveFile(id)
  void router.push({ name: 'project-management-editor' })
}

function deferContextAction(action: () => void | Promise<void>) {
  window.setTimeout(action, 0)
}

function requestRename() {
  deferContextAction(handleRename)
}

function requestDelete() {
  deferContextAction(handleDelete)
}

function requestNewFile() {
  deferContextAction(handleNewFile)
}

function requestNewFolder() {
  deferContextAction(handleNewFolder)
}

function requestSetAsTopFile() {
  deferContextAction(setAsTopFile)
}

function applyTopSelection(moduleName: string) {
  projectStore.setTopFile(props.node.id)
  projectStore.setTopModuleName(moduleName)
}

function setAsTopFile() {
  if (props.node.type !== 'file') {
    return
  }

  if (nodeModuleNames.value.length > 1) {
    const currentTopModule =
      projectStore.topFileId === props.node.id ? projectStore.topModuleName.trim() : ''
    pendingTopModuleName.value = nodeModuleNames.value.includes(currentTopModule)
      ? currentTopModule
      : (nodeModuleNames.value[0] ?? '')
    isTopModuleDialogOpen.value = true
    return
  }

  if (nodeModuleNames.value.length === 1) {
    applyTopSelection(nodeModuleNames.value[0] ?? '')
    return
  }

  projectStore.setTopFile(props.node.id)
  projectStore.setTopModuleName('')
}

function applyTopSelectionFromDialog() {
  if (!pendingTopModuleName.value) {
    return
  }

  applyTopSelection(pendingTopModuleName.value)
  isTopModuleDialogOpen.value = false
}
</script>

<template>
  <div class="pl-2">
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          class="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
          :class="{ 'bg-accent text-accent-foreground': projectStore.selectedNodeId === node.id }"
          @click="node.type === 'folder' ? toggleFolder() : openFile(node.id)"
          @contextmenu="selectNode"
        >
          <component
            :is="node.type === 'folder' ? (node.isOpen ? ChevronDown : ChevronRight) : FileCode"
            class="w-4 h-4 text-muted-foreground"
            :class="{ invisible: node.type === 'file' }"
          />
          <component
            :is="node.type === 'folder' ? Folder : FileCode"
            class="w-4 h-4"
            :class="node.type === 'folder' ? 'text-blue-400' : 'text-zinc-400'"
          />
          <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
          <span
            v-if="node.type === 'file' && projectStore.isFileDirty(node.id)"
            class="text-amber-600"
            :aria-label="t('unsavedChanges')"
          >
            *
          </span>
          <Badge
            v-if="node.type === 'file' && projectStore.topFileId === node.id"
            variant="secondary"
            class="gap-1 px-1.5 py-0 text-[10px] uppercase tracking-[0.18em]"
          >
            <CircuitBoard class="h-3 w-3" />
            {{ t('topFile') }}
          </Badge>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-48">
        <template v-if="node.type === 'file' && isHardwareSourceFile(node.name)">
          <ContextMenuItem @select="requestSetAsTopFile">
            <CircuitBoard class="w-4 h-4 mr-2" /> {{ t('setAsTopFile') }}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </template>
        <ContextMenuItem @select="requestRename">
          <Edit2 class="w-4 h-4 mr-2" /> {{ t('rename') }}
        </ContextMenuItem>
        <ContextMenuItem @select="requestDelete" class="text-destructive">
          <Trash2 class="w-4 h-4 mr-2" /> {{ t('delete') }}
        </ContextMenuItem>
        <template v-if="node.type === 'folder'">
          <ContextMenuSeparator />
          <ContextMenuItem @select="requestNewFile">
            <Plus class="w-4 h-4 mr-2" /> {{ t('newFile') }}
          </ContextMenuItem>
          <ContextMenuItem @select="requestNewFolder">
            <FolderPlus class="w-4 h-4 mr-2" /> {{ t('newFolder') }}
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="node.type === 'folder' && node.isOpen" class="ml-2 border-l border-border/50">
      <TreeNode v-for="child in node.children" :key="child.id" :node="child" />
    </div>
  </div>

  <Dialog :open="isTopModuleDialogOpen" @update:open="isTopModuleDialogOpen = $event">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ t('topModuleDialogTitle') }}</DialogTitle>
        <DialogDescription>
          {{ t('topModuleDialogChooseFromFile') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          {{ t('topModuleSourceHint', { name: node.name }) }}
        </p>
        <div class="space-y-2">
          <p class="text-sm font-medium">{{ t('topModuleLabel') }}</p>
          <Select v-model="pendingTopModuleName">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('selectTopModule')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="moduleName in nodeModuleNames"
                :key="moduleName"
                :value="moduleName"
              >
                <span class="font-mono text-xs">{{ moduleName }}</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="isTopModuleDialogOpen = false">
          {{ t('cancel') }}
        </Button>
        <Button
          type="button"
          :disabled="pendingTopModuleName.length === 0"
          @click="applyTopSelectionFromDialog"
        >
          {{ t('topModuleApply') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
