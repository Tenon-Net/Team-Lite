// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob, ICreateCronJobParams } from '@/common/adapter/ipcBridge';

/**
 * Build create-job params that re-home a captured cron job onto a replacement
 * team-member conversation after sync replace.
 */
export function buildRebindCronJobParams(job: ICronJob, nextConversationId: string): ICreateCronJobParams {
  return {
    name: job.name,
    description: job.description,
    schedule: job.schedule,
    message: job.target.payload.text,
    conversation_id: nextConversationId,
    conversation_title: job.metadata.conversation_title,
    created_by: job.metadata.created_by === 'agent' ? 'agent' : 'user',
    execution_mode: job.target.execution_mode,
    queue_enabled: job.state.queue_enabled,
    agent_config: job.metadata.agent_config
      ? {
          name: job.metadata.agent_config.name,
          assistant_id: job.metadata.agent_config.assistant_id,
          mode: job.metadata.agent_config.mode,
          model_id: job.metadata.agent_config.model_id,
          model: job.metadata.agent_config.model,
          config_options: job.metadata.agent_config.config_options,
          workspace: job.metadata.agent_config.workspace,
        }
      : undefined,
  };
}

export type RebindTeamMemberCronDeps = {
  getJob: (job_id: string) => Promise<ICronJob | null>;
  addJob: (params: ICreateCronJobParams) => Promise<ICronJob>;
  removeJob: (job_id: string) => Promise<unknown>;
  stampConversationCron: (conversation_id: string, cron_job_id: string) => Promise<unknown>;
};

/**
 * After a member slot is recreated, clone any preserved schedule onto the new
 * conversation and delete the old job so sync does not silently drop cron.
 */
export async function rebindTeamMemberCron(params: {
  previousJobId: string;
  nextConversationId: string;
  deps: RebindTeamMemberCronDeps;
}): Promise<ICronJob | undefined> {
  const previous = await params.deps.getJob(params.previousJobId);
  if (!previous) return undefined;

  const created = await params.deps.addJob(buildRebindCronJobParams(previous, params.nextConversationId));
  await params.deps.stampConversationCron(params.nextConversationId, created.id);
  try {
    await params.deps.removeJob(params.previousJobId);
  } catch {
    // New schedule already exists; orphaned old job is less bad than losing the schedule.
  }
  return created;
}
