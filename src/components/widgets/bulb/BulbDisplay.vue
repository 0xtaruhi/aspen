<template>
    <div class="flex h-full items-center justify-center">
        <BulbLight
            :color="state.color as string"
            :brightness="Number(state.brightness ?? 0)"
            :power="Boolean(state.power)"
            :size="Number(state.size ?? 120)"
        />
    </div>
</template>

<script setup lang="ts">
import BulbLight from "@/components/BulbLight.vue"

type BulbState = {
    power?: boolean
    color?: string
    brightness?: number
    size?: number
}

defineProps<{ state: BulbState }>()
</script>
