/** E5: cron out of scope — never resolve a job id. */
export function resolveCronJobId(_extra?: unknown): string | undefined {
  return undefined
}
export function listCronJobs(): never {
  throw new Error('cron is not available in Team-Lite')
}
export default { resolveCronJobId }
