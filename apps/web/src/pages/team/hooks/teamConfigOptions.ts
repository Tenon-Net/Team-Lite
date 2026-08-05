// @ts-nocheck
import type {
  AcpConfigOptionDto,
  GetConfigOptionsResponse,
  SetConfigOptionResponse,
} from '@/common/types/platform/acpTypes';
import { findConfigOption, hasObservedValue } from '@/renderer/hooks/agent/useAcpConfigOptions';

type TeamConfigOptionsLoad = (conversation_id: string) => Promise<AcpConfigOptionDto[] | null>;

export type TeamConfigOptionsLoader = TeamConfigOptionsLoad & {
  load: TeamConfigOptionsLoad;
  warmup: () => Promise<void>;
};

type CreateTeamConfigOptionsLoaderArgs = {
  team_id: string;
  warmupSession: () => Promise<void>;
  getConfigOptions: (team_id: string, conversation_id: string) => Promise<GetConfigOptionsResponse>;
  getTeamRuntimeModel?: (conversation_id: string) => Promise<string | null | undefined>;
  setConfigOption?: (conversation_id: string, option_id: string, value: string) => Promise<SetConfigOptionResponse>;
};

export function createTeamConfigOptionsLoader({
  team_id,
  warmupSession,
  getConfigOptions,
  getTeamRuntimeModel,
  setConfigOption,
}: CreateTeamConfigOptionsLoaderArgs): TeamConfigOptionsLoader {
  let warmupPromise: Promise<void> | null = null;

  const warmup = () => {
    if (!warmupPromise) {
      warmupPromise = warmupSession().catch((error) => {
        warmupPromise = null;
        throw error;
      });
    }
    return warmupPromise;
  };

  const load: TeamConfigOptionsLoad = async (conversation_id: string) => {
    const response = await getConfigOptions(team_id, conversation_id);
    const configOptions = response.config_options ?? null;
    const targetModel = (await getTeamRuntimeModel?.(conversation_id))?.trim();
    if (!configOptions || !targetModel || !setConfigOption) return configOptions;

    const modelOption = findConfigOption(configOptions, 'model', ['model']);
    if (!modelOption || modelOption.current_value === targetModel) return configOptions;
    if (!modelOption.options.some((option) => option.value === targetModel)) return configOptions;

    const updated = await setConfigOption(conversation_id, modelOption.id, targetModel);
    if (!hasObservedValue(updated, modelOption.id, targetModel)) {
      throw new Error('config_not_observed');
    }
    return updated.config_options;
  };

  return Object.assign(load, { load, warmup });
}
