// @ts-nocheck
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';

type RemoveAgentParams = {
  team_id: string;
  slot_id: string;
};

type RemoveTeamAssistantWithCronCleanupParams = {
  team: TTeam;
  slot_id: string;
  getConversation: (conversation_id: string) => Promise<TChatConversation | null>;
  removeCronJob: (job_id: string) => Promise<unknown>;
  removeAgent: (params: RemoveAgentParams) => Promise<unknown>;
  /**
   * When true, the member is removed but any cron job id is returned instead of deleted
   * so callers (sync replace) can rebind the schedule onto the replacement conversation.
   */
  preserveCron?: boolean;
};

type RemoveTeamWithCronCleanupParams = {
  team: TTeam;
  getConversation: (conversation_id: string) => Promise<TChatConversation | null>;
  removeCronJob: (job_id: string) => Promise<unknown>;
  removeTeam: (params: { id: string }) => Promise<unknown>;
};

type ArchiveTeamWithCronPauseParams = {
  team: TTeam;
  getConversation: (conversation_id: string) => Promise<TChatConversation | null>;
  pauseCronJob: (job_id: string) => Promise<unknown>;
  resumeCronJob: (job_id: string) => Promise<unknown>;
  archiveTeam: (params: { id: string }) => Promise<unknown>;
};

export async function removeTeamAssistantWithCronCleanup({
  team,
  slot_id,
  getConversation,
  removeCronJob,
  removeAgent,
  preserveCron = false,
}: RemoveTeamAssistantWithCronCleanupParams): Promise<string | undefined> {
  const assistant = team.assistants.find((item) => item.slot_id === slot_id);
  let preservedCronJobId: string | undefined;
  if (assistant?.conversation_id) {
    const conversation = await getConversation(assistant.conversation_id);
    const cronJobId = resolveCronJobId(conversation?.extra);
    if (cronJobId) {
      if (preserveCron) {
        preservedCronJobId = cronJobId;
      } else {
        await removeCronJob(cronJobId);
      }
    }
  }

  await removeAgent({ team_id: team.id, slot_id });
  return preservedCronJobId;
}

export async function removeTeamWithCronCleanup({
  team,
  getConversation,
  removeCronJob,
  removeTeam,
}: RemoveTeamWithCronCleanupParams): Promise<void> {
  const cronJobIds = new Set<string>();
  for (const assistant of team.assistants) {
    if (!assistant.conversation_id) continue;
    const conversation = await getConversation(assistant.conversation_id);
    const cronJobId = resolveCronJobId(conversation?.extra);
    if (cronJobId) {
      cronJobIds.add(cronJobId);
    }
  }

  for (const job_id of cronJobIds) {
    await removeCronJob(job_id);
  }

  await removeTeam({ id: team.id });
}

export async function archiveTeamWithCronPause({
  team,
  getConversation,
  pauseCronJob,
  resumeCronJob,
  archiveTeam,
}: ArchiveTeamWithCronPauseParams): Promise<void> {
  const cronJobIds = new Set<string>();
  for (const assistant of team.assistants) {
    if (!assistant.conversation_id) continue;
    const conversation = await getConversation(assistant.conversation_id);
    const cronJobId = resolveCronJobId(conversation?.extra);
    if (cronJobId) {
      cronJobIds.add(cronJobId);
    }
  }

  const pausedCronJobIds: string[] = [];
  try {
    for (const job_id of cronJobIds) {
      await pauseCronJob(job_id);
      pausedCronJobIds.push(job_id);
    }
    await archiveTeam({ id: team.id });
  } catch (error) {
    await Promise.allSettled(pausedCronJobIds.map((job_id) => resumeCronJob(job_id)));
    throw error;
  }
}
