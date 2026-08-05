/**
 * Minimal `@/common` barrel — upstream exports `ipcBridge` from here.
 */
import ipcBridge from './adapter/ipcBridge'

export { ipcBridge }
export default ipcBridge
export * from './adapter/httpBridge'
export type {
  IAddTeamAssistantParams,
  ICreateTeamParams,
  ICronJob,
  ICreateCronJobParams,
  IResponseMessage,
} from './adapter/ipcBridge'
