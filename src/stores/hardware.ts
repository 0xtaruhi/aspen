import { hardwareFlowStore } from './hardware-flow'
import { createHardwareStoreActions } from './hardware-store-actions'
import { createHardwareStoreView } from './hardware-store-view'

const hardwareStoreView = createHardwareStoreView()
const hardwareStoreActions = createHardwareStoreActions(hardwareStoreView.state)

export const hardwareStore = {
  ...hardwareStoreView,
  ...hardwareStoreActions,
  runSynthesis: hardwareFlowStore.runSynthesis,
  runImplementation: hardwareFlowStore.runImplementation,
}
