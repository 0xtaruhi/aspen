<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useI18n } from '@/lib/i18n'
import { importProjectFiles } from '@/lib/project-io'
import { projectStore } from '@/stores/project'
import { requestProjectTextInput } from '@/stores/project-text-input'
import { settingsStore } from '@/stores/settings'
import { confirmAction } from '@/lib/confirm-action'
import TreeNode from './TreeNode.vue'

const router = useRouter()
const { t } = useI18n()
const rootNode = computed(() => projectStore.rootNode)
const visibleNodes = computed(() => rootNode.value?.children ?? projectStore.files)
const explorerRef = ref<HTMLDivElement | null>(null)

async function handleNewFile() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = await requestProjectTextInput({
    title: t('newFile'),
    confirmLabel: t('newFile'),
    initialValue: 'new_file.v',
  })
  if (!name) {
    return
  }

  projectStore.createFile(parent.id, name)
  void router.push({ name: 'project-management-editor' })
}

async function handleNewFolder() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = await requestProjectTextInput({
    title: t('newFolder'),
    confirmLabel: t('newFolder'),
    initialValue: t('newFolder'),
  })
  if (!name) {
    return
  }

  projectStore.createFolder(parent.id, name)
}

function handleImportFiles() {
  void importProjectFiles()
}

function focusExplorer() {
  explorerRef.value?.focus()
}

async function handleRenameSelectedNode() {
  const node = projectStore.selectedNode
  if (!node) {
    return
  }

  const newName = await requestProjectTextInput({
    title: t('rename'),
    confirmLabel: t('rename'),
    initialValue: node.name,
  })
  if (!newName) {
    return
  }

  projectStore.renameNode(node.id, newName)
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
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          ref="explorerRef"
          class="flex-1 overflow-auto p-2 text-sm select-none outline-none"
          tabindex="0"
          @keydown="handleKeydown"
          @pointerdown="focusExplorer"
        >
          <div v-if="!projectStore.hasProject" class="flex h-full items-center justify-center">
            <p class="max-w-48 text-center text-xs text-muted-foreground">
              {{ t('noProjectLoadedDescription') }}
            </p>
          </div>
          <div v-else class="space-y-0.5">
            <template v-for="node in visibleNodes" :key="node.id">
              <TreeNode :node="node" />
            </template>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent v-if="rootNode" class="w-48">
        <ContextMenuItem @select="handleNewFile">{{ t('newFile') }}</ContextMenuItem>
        <ContextMenuItem @select="handleNewFolder">{{ t('newFolder') }}</ContextMenuItem>
        <ContextMenuItem @select="handleImportFiles">{{ t('importFiles') }}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
