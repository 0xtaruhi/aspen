import { reactive } from 'vue'

export const topModuleDialogStore = reactive({
  isOpen: false,
  preferredSourceId: '',

  open(preferredSourceId = '') {
    this.preferredSourceId = preferredSourceId
    this.isOpen = true
  },

  close() {
    this.isOpen = false
    this.preferredSourceId = ''
  },
})
