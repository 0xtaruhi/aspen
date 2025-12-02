<template>
    <div class="h-full overflow-auto">
        <div ref="gridWrap" class="pt-2" :style="{ width: `${gridWidth}px` }" @dragover.prevent @drop="handleDrop">
            <GridLayout v-model:layout="layout" :col-num="gridColumns" :row-height="COLUMN_SIZE"
                :is-draggable="draggable" :is-resizable="false" :auto-size="false" :vertical-compact="false"
                :prevent-collision="true" :use-css-transforms="true" :responsive="false" :margin="[MARGIN, MARGIN]"
                :container-padding="[0, 0]">
                <GridItem v-for="item in layout" :key="item.i" :i="item.i" :x="item.x" :y="item.y" :w="item.w"
                    :h="item.h" :static="Boolean(item.static)" drag-allow-from=".widget-drag-handle"
                    drag-ignore-from=".no-drag">
                    <WidgetRenderer v-if="widgets[item.i]" :widget="widgets[item.i]" :state="widgets[item.i].state"
                        @update:state="value => updateWidgetState(item.i, value)" @remove="removeWidget(item.i)" />
                </GridItem>
            </GridLayout>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from "vue"

import { GridItem, GridLayout } from "vue3-grid-layout"

import WidgetRenderer from "@/components/widgets/WidgetRenderer.vue"
import { createWidgetInstance, type WidgetInstance } from "@/components/widgets/registry"

type LayoutItem = {
    x: number
    y: number
    w: number
    h: number
    i: string
    static?: boolean
}

const COLUMN_SIZE = 96
const MARGIN = 6
const MIN_COLUMNS = 12 // 最小列数

const gridWrap = ref<HTMLElement | null>(null)
const draggable = ref(true)

// 动态计算列数和grid宽度
const gridColumns = ref(MIN_COLUMNS)
const gridWidth = ref(MIN_COLUMNS * COLUMN_SIZE + (MIN_COLUMNS - 1) * MARGIN)

// 计算可容纳的列数
function calculateColumns(containerWidth: number): number {
    // 每列需要的宽度：列宽 + 间距
    const columnWidth = COLUMN_SIZE + MARGIN
    // 计算窗口可容纳的列数
    const windowColumns = Math.max(MIN_COLUMNS, Math.floor(containerWidth / columnWidth))

    // 计算当前组件中最大的列数（最右边组件的x + w）
    const maxComponentColumn = layout.value.reduce((max, item) => {
        return Math.max(max, item.x + item.w)
    }, 0)

    // 取两者的最大值，确保所有组件都能显示
    const calculatedColumns = Math.max(windowColumns, maxComponentColumn)
    return calculatedColumns
}

// 更新grid尺寸
function updateGridSize() {
    if (!gridWrap.value) return

    const containerWidth = gridWrap.value.parentElement?.clientWidth || 0
    const newColumns = calculateColumns(containerWidth)

    if (newColumns !== gridColumns.value) {
        gridColumns.value = newColumns
        gridWidth.value = newColumns * COLUMN_SIZE + (newColumns - 1) * MARGIN
    }
}

const layout = ref<LayoutItem[]>([
    { x: 0, y: 0, w: 2, h: 2, i: "bulb-1" },
    { x: 2, y: 0, w: 2, h: 2, i: "switch-1" },
])

const widgets = reactive<Record<string, WidgetInstance>>({
    "bulb-1": createWidgetInstance("bulb-1", "bulb"),
    "switch-1": createWidgetInstance("switch-1", "switch"),
})

function updateWidgetState(id: string, value: Record<string, unknown>) {
    const widget = widgets[id]
    if (!widget) {
        return
    }

    widget.state = value
}

function removeWidget(id: string) {
    layout.value = layout.value.filter(item => item.i !== id)
    if (id in widgets) {
        delete widgets[id]
    }
}

function handleDrop(ev: DragEvent) {
    if (!ev.dataTransfer) return
    const type = ev.dataTransfer.getData('application/x-widget')
    if (!type) return
    // place at row 0, next free col
    const nextX = layout.value.reduce((max, it) => Math.max(max, it.x + it.w), 0) % gridColumns.value
    const nextY = 0
    const id = `${type}-${Date.now().toString(36)}`
    layout.value.push({ x: nextX, y: nextY, w: 2, h: 2, i: id })
    widgets[id] = createWidgetInstance(id, type as any)
}

// 监听layout变化，当组件位置改变时更新grid列数
watch(layout, () => {
    updateGridSize()
}, { deep: true })

// 监听窗口大小变化
onMounted(() => {
    // 初始化grid尺寸
    updateGridSize()

    // 监听窗口大小变化
    const resizeObserver = new ResizeObserver(() => {
        updateGridSize()
    })

    if (gridWrap.value?.parentElement) {
        resizeObserver.observe(gridWrap.value.parentElement)
    }

    // 清理
    onUnmounted(() => {
        resizeObserver.disconnect()
    })
})
</script>

<style>
.vue-grid-item.vue-grid-placeholder {
    background: rgba(0, 0, 0, 0.22) !important;
    border-radius: 20px;
}

.dark .vue-grid-item.vue-grid-placeholder {
    background: rgba(250, 250, 250, 0.22) !important;
}
</style>
