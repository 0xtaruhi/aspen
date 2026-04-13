<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useI18n } from '@/lib/i18n'
import { importProjectFiles } from '@/lib/project-io'
import { projectStore } from '@/stores/project'
import { settingsStore } from '@/stores/settings'
import { confirmAction } from '@/lib/confirm-action'
import type { ProjectTreeDropTarget, ProjectTreeDropMode } from './tree-dnd'
import TreeNode from './TreeNode.vue'

const { t } = useI18n()
const rootNode = computed(() => projectStore.rootNode)
const visibleNodes = computed(() => rootNode.value?.children ?? projectStore.files)
const explorerRef = ref<HTMLDivElement | null>(null)
const draggedNodeId = ref<string | null>(null)
const dropTarget = ref<ProjectTreeDropTarget | null>(null)
const dragStarted = ref(false)
const suppressedClickNodeId = ref<string | null>(null)
const pendingDragState = ref<{
  nodeId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
} | null>(null)
const pendingContextMenuAction = ref<'new-file' | 'new-folder' | null>(null)

function handleNewFile() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  projectStore.beginCreatingFile(parent.id)
}

function handleNewFolder() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  projectStore.beginCreatingFolder(parent.id, t('newFolder'))
}

function handleImportFiles() {
  void importProjectFiles()
}

function focusExplorer() {
  explorerRef.value?.focus()
}

function requestNewFile() {
  pendingContextMenuAction.value = 'new-file'
}

function requestNewFolder() {
  pendingContextMenuAction.value = 'new-folder'
}

function handleContextMenuCloseAutoFocus(event: Event) {
  if (!pendingContextMenuAction.value) {
    return
  }

  const action = pendingContextMenuAction.value
  event.preventDefault()
  pendingContextMenuAction.value = null

  window.requestAnimationFrame(() => {
    if (action === 'new-file') {
      handleNewFile()
      return
    }

    handleNewFolder()
  })
}

function clearDragState() {
  dragStarted.value = false
  draggedNodeId.value = null
  dropTarget.value = null
  pendingDragState.value = null
  window.removeEventListener('pointermove', handleWindowPointerMove)
  window.removeEventListener('pointerup', handleWindowPointerUp)
  window.removeEventListener('pointercancel', handleWindowPointerUp)
}

function handleRenameSelectedNode() {
  const node = projectStore.selectedNode
  if (!node) {
    return
  }

  projectStore.beginRenamingNode(node.id)
}

async function handleDeleteSelectedNode() {
  const node = projectStore.selectedNode
  if (!node) {
    return
  }

  if (
    !settingsStore.state.confirmDelete ||
    (await confirmAction(t('deleteFileConfirm', { name: node.name }), {
      title: t('deleteFileTitle'),
    }))
  ) {
    projectStore.deleteNode(node.id)
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (!projectStore.selectedNode) {
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    handleRenameSelectedNode()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    void handleDeleteSelectedNode()
  }
}

function handleNodePointerDown(nodeId: string, event: PointerEvent) {
  if (event.button !== 0) {
    return
  }

  pendingDragState.value = {
    nodeId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
  }
  draggedNodeId.value = nodeId
  dropTarget.value = null
  dragStarted.value = false

  window.addEventListener('pointermove', handleWindowPointerMove)
  window.addEventListener('pointerup', handleWindowPointerUp)
  window.addEventListener('pointercancel', handleWindowPointerUp)
}

function handleNodePointerMove(nodeId: string, mode: Exclude<ProjectTreeDropMode, 'root'>) {
  if (!draggedNodeId.value || draggedNodeId.value === nodeId) {
    return
  }

  dropTarget.value = {
    nodeId,
    mode,
  }
}

function handleRootPointerMove(event: PointerEvent) {
  if (!draggedNodeId.value || !dragStarted.value) {
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest('[data-project-tree-row="true"]')) {
    return
  }

  dropTarget.value = {
    nodeId: null,
    mode: 'root',
  }
}

function commitDrop() {
  if (!dragStarted.value || !draggedNodeId.value || !dropTarget.value) {
    return
  }

  if (dropTarget.value.mode === 'root') {
    projectStore.moveNode(
      draggedNodeId.value,
      rootNode.value?.id ?? null,
      visibleNodes.value.length,
    )
    return
  }

  const targetLocation = projectStore.findNodeLocation(dropTarget.value.nodeId ?? '')
  if (!targetLocation) {
    return
  }

  if (dropTarget.value.mode === 'inside') {
    if (targetLocation.node.type !== 'folder') {
      return
    }

    projectStore.moveNode(
      draggedNodeId.value,
      targetLocation.node.id,
      targetLocation.node.children?.length ?? 0,
    )
    return
  }

  projectStore.moveNode(
    draggedNodeId.value,
    targetLocation.parent?.id ?? null,
    dropTarget.value.mode === 'before' ? targetLocation.index : targetLocation.index + 1,
  )
}

function handleWindowPointerMove(event: PointerEvent) {
  const state = pendingDragState.value
  if (!state) {
    return
  }

  state.currentX = event.clientX
  state.currentY = event.clientY

  if (dragStarted.value) {
    return
  }

  const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
  if (distance < 4) {
    return
  }

  dragStarted.value = true
}

function clearSuppressedClick() {
  suppressedClickNodeId.value = null
}

function handleWindowPointerUp() {
  if (dragStarted.value && draggedNodeId.value) {
    suppressedClickNodeId.value = draggedNodeId.value
    window.setTimeout(clearSuppressedClick, 0)
    commitDrop()
  }

  clearDragState()
}

function consumeSuppressedClick(nodeId: string) {
  if (suppressedClickNodeId.value === nodeId) {
    suppressedClickNodeId.value = null
  }
}
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          ref="explorerRef"
          class="flex-1 overflow-auto p-2 text-sm select-none outline-none"
          :class="{
            'rounded-md bg-accent/30 ring-1 ring-primary/30':
              dropTarget?.mode === 'root' && dropTarget.nodeId === null,
          }"
          tabindex="0"
          @keydown="handleKeydown"
          @pointerdown="focusExplorer"
          @pointermove="handleRootPointerMove"
        >
          <div v-if="!projectStore.hasProject" class="flex h-full items-center justify-center">
            <p class="max-w-48 text-center text-xs text-muted-foreground">
              {{ t('noProjectLoadedDescription') }}
            </p>
          </div>
          <div v-else class="space-y-0.5">
            <template v-for="node in visibleNodes" :key="node.id">
              <TreeNode
                :node="node"
                :dragged-node-id="draggedNodeId"
                :drag-started="dragStarted"
                :drop-target="dropTarget"
                :suppressed-click-node-id="suppressedClickNodeId"
                @pointer-down-node="handleNodePointerDown"
                @pointer-move-node="handleNodePointerMove"
                @consume-suppressed-click="consumeSuppressedClick"
              />
            </template>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        v-if="rootNode"
        class="w-48"
        @close-auto-focus="handleContextMenuCloseAutoFocus"
      >
        <ContextMenuItem @select="requestNewFile">{{ t('newFile') }}</ContextMenuItem>
        <ContextMenuItem @select="requestNewFolder">{{ t('newFolder') }}</ContextMenuItem>
        <ContextMenuItem @select="handleImportFiles">{{ t('importFiles') }}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
