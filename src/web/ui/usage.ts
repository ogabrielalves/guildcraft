import type { AgentUsage } from '../../shared/activity.js';
import { emptyUsage } from '../../shared/activity.js';
import { t } from '../i18n/index.js';

export function formatCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function totalUsage(usages: Iterable<AgentUsage>): AgentUsage {
  const total = emptyUsage();
  for (const usage of usages) {
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
  }
  return total;
}

export function usageText(usage: AgentUsage): string {
  return t('usage.tokens', { count: formatCount(usage.input + usage.output + usage.cacheWrite) });
}

export function usageTitle(usage: AgentUsage): string {
  return t('usage.tokensTitle', {
    input: formatCount(usage.input),
    output: formatCount(usage.output),
    cacheRead: formatCount(usage.cacheRead),
    cacheWrite: formatCount(usage.cacheWrite),
  });
}
