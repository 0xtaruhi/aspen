<script setup lang="ts">
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
import { useI18n } from '@/lib/i18n'
import { projectStore, type ProjectNode } from '@/stores/project'
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

function isHardwareSourceFile(name: string) {
  return name.endsWith('.v') || name.endsWith('.sv')
}

function toggleFolder() {
  if (props.node.type === 'folder') {
    props.node.isOpen = !props.node.isOpen
  }
}

function handleRename() {
  const newName = prompt(t('enterNewName'), props.node.name)
  if (newName) {
    projectStore.renameNode(props.node.id, newName)
  }
}

function handleNewFile() {
  const name = prompt(t('enterFileName'), 'new_file.v')
  if (name) {
    projectStore.createFile(props.node.id, name)
    void router.push({ name: 'project-management-editor' })
  }
}

function handleNewFolder() {
  const name = prompt(t('enterFolderName'), t('newFolder'))
  if (name) {
    projectStore.createFolder(props.node.id, name)
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

function setAsTopFile() {
  if (props.node.type === 'file') {
    projectStore.setTopFile(props.node.id)
  }
}
</script>

<template>
  <div class="pl-2">
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          class="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
          :class="{ 'bg-accent text-accent-foreground': projectStore.activeFileId === node.id }"
          @click="node.type === 'folder' ? toggleFolder() : openFile(node.id)"
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
          <ContextMenuItem @select="setAsTopFile">
            <CircuitBoard class="w-4 h-4 mr-2" /> {{ t('setAsTopFile') }}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </template>
        <ContextMenuItem @select="handleRename">
          <Edit2 class="w-4 h-4 mr-2" /> {{ t('rename') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleDelete" class="text-destructive">
          <Trash2 class="w-4 h-4 mr-2" /> {{ t('delete') }}
        </ContextMenuItem>
        <template v-if="node.type === 'folder'">
          <ContextMenuSeparator />
          <ContextMenuItem @select="handleNewFile">
            <Plus class="w-4 h-4 mr-2" /> {{ t('newFile') }}
          </ContextMenuItem>
          <ContextMenuItem @select="handleNewFolder">
            <FolderPlus class="w-4 h-4 mr-2" /> {{ t('newFolder') }}
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="node.type === 'folder' && node.isOpen" class="ml-2 border-l border-border/50">
      <TreeNode v-for="child in node.children" :key="child.id" :node="child" />
    </div>
  </div>
</template>
