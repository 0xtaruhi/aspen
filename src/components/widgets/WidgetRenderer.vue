<template>
    <BaseWidget :title="widget.title" @open-settings="openSettings" @remove="emitRemove">
        <component
            :is="displayComponent"
            :state="state"
            :definition="definition"
            @update="applyPatch"
            @update:state="replaceState"
            @close-settings="closeSettings"
        />
    </BaseWidget>
    <RightDrawer v-model:modelValue="drawerOpen" :title="settingsTitle" :description="settingsDescription">
        <component
            :is="settingsComponent"
            :state="state"
            :definition="definition"
            @update="applyPatch"
            @update:state="replaceState"
            @close-settings="closeSettings"
        />
    </RightDrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"

import BaseWidget from "@/components/BaseWidget.vue"
import RightDrawer from "@/components/RightDrawer.vue"

import { getWidgetDefinition, type WidgetInstance } from "./registry"

type Props = {
    widget: WidgetInstance
    state: Record<string, unknown>
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: "update:state", value: Record<string, unknown>): void; (e: "remove"): void }>()

const drawerOpen = ref(false)

const definition = computed(() => getWidgetDefinition(props.widget.type))
const displayComponent = computed(() => definition.value.display)
const settingsComponent = computed(() => definition.value.settings)
const settingsTitle = computed(() => definition.value.settingsTitle ?? props.widget.title)
const settingsDescription = computed(() => definition.value.settingsDescription ?? "")

function openSettings() {
    drawerOpen.value = true
}

function closeSettings() {
    drawerOpen.value = false
}

function emitRemove() {
    emit("remove")
}

function applyPatch(patch: unknown) {
    if (!patch || typeof patch !== "object") {
        return
    }

    emit("update:state", { ...props.state, ...(patch as Record<string, unknown>) })
}

function replaceState(next: unknown) {
    if (!next || typeof next !== "object") {
        return
    }

    emit("update:state", next as Record<string, unknown>)
}
</script>
