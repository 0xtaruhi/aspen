declare module 'vue3-grid-layout' {
  import type { DefineComponent } from 'vue'

  export const GridLayout: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >
  export const GridItem: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >
}
