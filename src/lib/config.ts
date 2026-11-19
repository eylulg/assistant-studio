import { z } from 'zod';
import { DEFAULT_MODEL, MODEL_OPTIONS } from './models';

const positiveInt = (fallback: number) => z.coerce.number().int().positive().catch(fallback);
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const envSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  CHAT_DEFAULT_MODEL: z.enum(MODEL_OPTIONS.map((option) => option.id)).catch(DEFAULT_MODEL),
  CHAT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).catch('medium'),
  MAX_OUTPUT_TOKENS: positiveInt(4096),
  MAX_ROUNDS: positiveInt(5),
  MAX_BODY_BYTES: positiveInt(200_000),
  RATE_LIMIT_REQUESTS: positiveInt(20),
  DEMO_PACE: z.coerce.number().min(0).max(5).catch(1),
  RATE_LIMIT_WINDOW_SECONDS: positiveInt(600),
});

/** Server-side configuration, validated from the environment on every request so tests can change it. */
export function serverConfig() {
  const env = envSchema.parse(process.env);
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    defaultModel: env.CHAT_DEFAULT_MODEL,
    effort: env.CHAT_EFFORT,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    maxRounds: env.MAX_ROUNDS,
    maxBodyBytes: env.MAX_BODY_BYTES,
    demoPace: env.DEMO_PACE,
    rateLimitPerWindow: env.RATE_LIMIT_REQUESTS,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
  };
}
