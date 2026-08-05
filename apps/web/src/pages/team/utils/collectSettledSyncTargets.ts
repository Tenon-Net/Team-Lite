// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

export type SettledSyncTargetPlan<TAssistant, TTarget> = {
  assistant: TAssistant;
  target: TTarget;
};

export type CollectSettledSyncTargetsResult<TAssistant, TTarget> = {
  plans: Array<SettledSyncTargetPlan<TAssistant, TTarget>>;
  failed: number;
  /** First rejection reason from target resolution, if any. */
  firstError?: unknown;
};

/**
 * Fold Promise.allSettled results for per-member sync target resolution.
 * Keeps successful plans and preserves the first failure for UI diagnosis
 * (e.g. ClaudeTeamProviderRequiredError) instead of only counting failures.
 */
export function collectSettledSyncTargets<TAssistant, TTarget>(
  candidates: readonly TAssistant[],
  results: ReadonlyArray<PromiseSettledResult<TTarget>>
): CollectSettledSyncTargetsResult<TAssistant, TTarget> {
  const plans: Array<SettledSyncTargetPlan<TAssistant, TTarget>> = [];
  let failed = 0;
  let firstError: unknown;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      plans.push({ assistant: candidates[index], target: result.value });
      return;
    }
    failed += 1;
    if (firstError === undefined) {
      firstError = result.reason;
    }
  });

  return firstError === undefined ? { plans, failed } : { plans, failed, firstError };
}
