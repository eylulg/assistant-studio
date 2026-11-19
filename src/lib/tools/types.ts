import { z } from 'zod';

export const prioritySchema = z.enum(['low', 'normal', 'high']);

export const taskSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  priority: prioritySchema,
  done: z.boolean(),
  createdAt: z.string().max(40),
});

export type Task = z.infer<typeof taskSchema>;

export interface ToolContext {
  now: () => Date;
  /** Shown in get_time output so a frozen demo clock is never mistaken for the real one. */
  clock: 'system' | 'frozen';
  /** Snapshot of the task list the client sent with the request. */
  tasks: readonly Task[];
  signal?: AbortSignal;
  /** Fixture tools wait a little to resemble a network call. Evals and tests switch it off. */
  simulateLatency: boolean;
}

/** An expected failure the model can read and recover from, such as an unknown unit. */
export class ToolError extends Error {}

interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  /** Side-effect tools never run on the server: they pause the stream for approval in the client. */
  sideEffect: boolean;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}

export interface Tool {
  name: string;
  description: string;
  sideEffect: boolean;
  schema: z.ZodType;
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

/** Erases the input type once, so the registry is a plain list and each handler keeps a precise one. */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): Tool {
  const { run, schema, ...rest } = definition;
  return { ...rest, schema, execute: async (input, ctx) => run(schema.parse(input), ctx) };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
