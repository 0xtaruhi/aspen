<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { extractVerilogModuleNames } from '@/lib/verilog-modules'
import { projectStore, type ProjectNode } from '@/stores/project'
import { topModuleDialogStore } from '@/stores/top-module-dialog'
import { settingsStore } from '@/stores/settings'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { confirmAction } from '@/lib/confirm-action'
import type { ProjectTreeDropMode, ProjectTreeDropTarget } from './tree-dnd'

type InputHandle = {
  focus: () => void
  select: () => void
}

const props = defineProps<{
  node: ProjectNode
  draggedNodeId: string | null
  dragStarted: boolean
  dropTarget: ProjectTreeDropTarget | null
  suppressedClickNodeId: string | null
}>()

const emit = defineEmits<{
  (e: 'pointer-down-node', nodeId: string, event: PointerEvent): void
  (e: 'pointer-move-node', nodeId: string, mode: Exclude<ProjectTreeDropMode, 'root'>): void
  (e: 'consume-suppressed-click', nodeId: string): void
}>()

const router = useRouter()
const { t } = useI18n()
const renameInputRef = ref<InputHandle | null>(null)
const renameValue = ref('')
const isRenaming = computed(() => projectStore.renamingNodeId === props.node.id)
const pendingContextMenuAction = ref<'rename' | 'new-file' | 'new-folder' | null>(null)

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

function handlePrimaryAction() {
  if (props.suppressedClickNodeId === props.node.id) {
    emit('consume-suppressed-click', props.node.id)
    return
  }

  selectNode()

  if (isRenaming.value) {
    return
  }

  if (props.node.type === 'folder') {
    props.node.isOpen = !props.node.isOpen
    return
  }

  openFile(props.node.id)
}

function startRename() {
  projectStore.beginRenamingNode(props.node.id)
}

function beginCreatingFile() {
  projectStore.beginCreatingFile(props.node.id)
}

function beginCreatingFolder() {
  projectStore.beginCreatingFolder(props.node.id, t('newFolder'))
}

function cancelRename() {
  projectStore.cancelRenamingNode(props.node.id)
}

function commitRename() {
  if (!isRenaming.value) {
    return
  }

  const result = projectStore.commitNodeRename(props.node.id, renameValue.value)
  if (result.kind === 'created' && result.nodeType === 'file') {
    openFile(result.id)
  }
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
  pendingContextMenuAction.value = 'rename'
}

function handleContextMenuCloseAutoFocus(event: Event) {
  if (!pendingContextMenuAction.value) {
    return
  }

  const action = pendingContextMenuAction.value
  event.preventDefault()
  pendingContextMenuAction.value = null
  window.requestAnimationFrame(() => {
    switch (action) {
      case 'rename':
        startRename()
        break
      case 'new-file':
        beginCreatingFile()
        break
      case 'new-folder':
        beginCreatingFolder()
        break
    }
  })
}

function requestDelete() {
  deferContextAction(handleDelete)
}

function requestNewFile() {
  pendingContextMenuAction.value = 'new-file'
}

function requestNewFolder() {
  pendingContextMenuAction.value = 'new-folder'
}

function requestSetAsTopFile() {
  deferContextAction(setAsTopFile)
}

function setAsTopFile() {
  if (props.node.type !== 'file') {
    return
  }

  projectStore.setTopFile(props.node.id)

  if (nodeModuleNames.value.length > 1) {
    topModuleDialogStore.open(props.node.id)
    return
  }

  if (nodeModuleNames.value.length === 1) {
    projectStore.setTopModuleName(nodeModuleNames.value[0] ?? '')
    return
  }

  projectStore.setTopModuleName('')
}

type PointerLikeEvent = {
  currentTarget: EventTarget | null
  clientY: number
}

function resolveDropMode(event: PointerLikeEvent): Exclude<ProjectTreeDropMode, 'root'> {
  const element = event.currentTarget as HTMLElement | null
  if (!element) {
    return props.node.type === 'folder' ? 'inside' : 'after'
  }

  const rect = element.getBoundingClientRect()
  const offsetY = event.clientY - rect.top
  const height = Math.max(rect.height, 1)
  const ratio = offsetY / height

  if (props.node.type === 'folder') {
    if (ratio <= 0.25) {
      return 'before'
    }
    if (ratio >= 0.75) {
      return 'after'
    }
    return 'inside'
  }

  return ratio <= 0.5 ? 'before' : 'after'
}

function handlePointerDown(event: PointerEvent) {
  if (isRenaming.value || event.button !== 0) {
    return
  }

  emit('pointer-down-node', props.node.id, event)
}

function handlePointerMove(event: PointerEvent) {
  if (!props.draggedNodeId || !props.dragStarted || props.draggedNodeId === props.node.id) {
    return
  }

  const mode = resolveDropMode(event)
  if (mode === 'inside' && props.node.type === 'folder' && !props.node.isOpen) {
    props.node.isOpen = true
  }
  emit('pointer-move-node', props.node.id, mode)
}

const isDropBefore = computed(
  () => props.dropTarget?.nodeId === props.node.id && props.dropTarget.mode === 'before',
)
const isDropInside = computed(
  () => props.dropTarget?.nodeId === props.node.id && props.dropTarget.mode === 'inside',
)
const isDropAfter = computed(
  () => props.dropTarget?.nodeId === props.node.id && props.dropTarget.mode === 'after',
)
const isDragging = computed(() => props.draggedNodeId === props.node.id)

function focusRenameInput() {
  const input = renameInputRef.value
  if (!input) {
    return
  }

  input.focus()
  input.select()
}

watch(
  isRenaming,
  (active) => {
    if (!active) {
      renameValue.value = props.node.name
      return
    }

    renameValue.value = props.node.name
    void nextTick(() => {
      window.requestAnimationFrame(focusRenameInput)
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="pl-2">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="relative">
          <div
            v-if="isDropBefore"
            class="pointer-events-none absolute inset-x-2 top-0 z-10 h-0.5 rounded-full bg-primary"
          />
          <div
            data-project-tree-row="true"
            class="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
            :class="[
              { 'bg-accent text-accent-foreground': projectStore.selectedNodeId === node.id },
              { 'bg-accent/60 ring-1 ring-primary/30': isDropInside },
              { 'opacity-55': isDragging },
            ]"
            @click="handlePrimaryAction"
            @contextmenu="selectNode"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
          >
            <button
              type="button"
              class="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
              :class="{ invisible: node.type === 'file' }"
              @pointerdown.stop
              @click.stop="toggleFolder"
            >
              <component
                :is="node.type === 'folder' ? (node.isOpen ? ChevronDown : ChevronRight) : FileCode"
                class="w-4 h-4"
              />
            </button>
            <component
              :is="node.type === 'folder' ? Folder : FileCode"
              class="w-4 h-4 shrink-0"
              :class="node.type === 'folder' ? 'text-blue-400' : 'text-zinc-400'"
            />
            <div class="min-w-0 flex-1">
              <Input
                v-if="isRenaming"
                ref="renameInputRef"
                v-model="renameValue"
                class="h-7 border-border/70 bg-background/90 px-2 text-sm"
                @click.stop
                @pointerdown.stop
                @keydown.stop
                @blur="commitRename"
                @keydown.enter.stop.prevent="commitRename"
                @keydown.esc.stop.prevent="cancelRename"
              />
              <span v-else class="block truncate" @dblclick.stop.prevent="startRename">
                {{ node.name }}
              </span>
            </div>
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
          <div
            v-if="isDropAfter"
            class="pointer-events-none absolute inset-x-2 bottom-0 z-10 h-0.5 rounded-full bg-primary"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-48" @close-auto-focus="handleContextMenuCloseAutoFocus">
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
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :dragged-node-id="draggedNodeId"
        :drag-started="dragStarted"
        :drop-target="dropTarget"
        :suppressed-click-node-id="suppressedClickNodeId"
        @pointer-down-node="(nodeId, event) => emit('pointer-down-node', nodeId, event)"
        @pointer-move-node="(nodeId, mode) => emit('pointer-move-node', nodeId, mode)"
        @consume-suppressed-click="emit('consume-suppressed-click', $event)"
      />
    </div>
  </div>
</template>
