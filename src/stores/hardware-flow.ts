import { implementationFlowStore } from './hardware-flow-implementation'
import { synthesisFlowStore } from './hardware-flow-synthesis'

export const hardwareFlowStore = {
  synthesisRunning: synthesisFlowStore.synthesisRunning,
  synthesisReport: synthesisFlowStore.synthesisReport,
  synthesisReportSignature: synthesisFlowStore.synthesisReportSignature,
  synthesisLiveLog: synthesisFlowStore.synthesisLiveLog,
  synthesisMessage: synthesisFlowStore.synthesisMessage,
  implementationRunning: implementationFlowStore.implementationRunning,
  implementationReport: implementationFlowStore.implementationReport,
  implementationReportSignature: implementationFlowStore.implementationReportSignature,
  implementationLiveLog: implementationFlowStore.implementationLiveLog,
  implementationMessage: implementationFlowStore.implementationMessage,
  runSynthesis: synthesisFlowStore.runSynthesis,
  runImplementation: implementationFlowStore.runImplementation,
}
