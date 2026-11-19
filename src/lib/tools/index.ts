import { z } from 'zod';
import { calculate } from './calculate';
import { convertUnits } from './convert-units';
import { getTime } from './get-time';
import { searchNotesTool } from './search-notes';
import { createTask, listTasks } from './tasks';
import { type Tool, type ToolContext, ToolError } from './types';
import { lookupWeather } from './weather';

const TOOLS: readonly Tool[] = [
  calculate,
  convertUnits,
  getTime,
  searchNotesTool,
  createTask,
  listTasks,
  lookupWeather,
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** The tool definitions in the shape the Messages API takes. Input schemas come from the same zod schemas that validate the calls. */
export function toolDefinitions() {
  return TOOLS.map((tool) => {
    const { $schema: _unused, ...inputSchema } = z.toJSONSchema(tool.schema, {
      target: 'draft-2020-12',
      io: 'input',
    });
    return {
      name: tool.name,
      description: tool.description,
      input_schema: { ...inputSchema, type: 'object' as const },
    };
  });
}

export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };

export function validateInput(
  tool: Tool,
  raw: unknown,
): { ok: true; input: unknown } | { ok: false; error: string } {
  const parsed = tool.schema.safeParse(raw);
  if (parsed.success) return { ok: true, input: parsed.data };
  return {
    ok: false,
    error: `Invalid input for ${tool.name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}`,
  };
}

/** Runs a tool and turns an expected failure into a message the model can read. Aborts propagate. */
export async function runTool(tool: Tool, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    return { ok: true, output: await tool.execute(input, ctx) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}
