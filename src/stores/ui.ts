import { ref } from 'vue'

export type Page = 'editor' | 'status' | 'synthesis' | 'implementation' | 'hardware'

export const uiStore = {
  activePage: ref<Page>('editor'),

  setPage(page: Page) {
    this.activePage.value = page
  },
}
