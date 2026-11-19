import type { Usage } from './protocol';

interface ModelOption {
  id: string;
  label: string;
  description: string;
  /** US dollars per million tokens. Cache reads cost a tenth of input, cache writes 1.25 times. */
  price: { input: number; output: number };
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: DEFAULT_MODEL,
    label: 'Claude Sonnet 5.5',
    description: 'Fast and the default for the public demo',
    price: { input: 2, output: 10 },
  },
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'The thorough option, about twice the price',
    price: { input: 4, output: 20 },
  },
];

export function isKnownModel(id: string): boolean {
  return MODEL_OPTIONS.some((option) => option.id === id);
}

export function modelLabel(id: string): string {
  return MODEL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/** An estimate from list prices, so it is labelled as one wherever it is shown. */
export function estimateCostUsd(model: string, usage: Usage): number {
  const price = (MODEL_OPTIONS.find((option) => option.id === model) ?? MODEL_OPTIONS[0])?.price;
  if (!price) return 0;
  return (
    (usage.inputTokens * price.input +
      usage.cacheReadTokens * price.input * 0.1 +
      usage.cacheWriteTokens * price.input * 1.25 +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
