import { findTool, runTool, toolDefinitions, validateInput } from '..';
import { describe, expect, it } from 'vitest';
import { searchNotes } from '../search-notes';
import type { Task, ToolContext } from '../types';

const context: ToolContext = {
  now: () => new Date('2026-11-10T09:30:00.000Z'),
  clock: 'frozen',
  tasks: [],
  simulateLatency: false,
};

async function run(name: string, input: unknown, ctx: ToolContext = context) {
  const tool = findTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return runTool(tool, input, ctx);
}

describe('calculate', () => {
  it.each([
    ['2450 * 0.18 + 75', 516],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['2 ^ 3 ^ 2', 512],
    ['-3 ^ 2', -9],
    ['17 % 5', 2],
    ['sqrt(144) + max(1, 7, 3)', 19],
    ['round(pi * 100) / 100', 3.14],
    ['1e3 + .5', 1000.5],
  ])('evaluates %s', async (expression, result) => {
    expect(await run('calculate', { expression })).toEqual({
      ok: true,
      output: { expression, result },
    });
  });

  it.each([
    ['1 / 0', 'Division by zero.'],
    ['2 +', 'The expression ends too early.'],
    ['(1 + 2', 'Expected ")" in the expression.'],
    ['foo(1)', expect.stringContaining('Unknown name "foo"')],
    ['process.exit(1)', 'Unexpected character "." in the expression.'],
    ['constructor', expect.stringContaining('Unknown name "constructor"')],
    ['1 $ 2', expect.stringContaining('Unexpected character "$"')],
    ['('.repeat(60) + '1' + ')'.repeat(60), 'The expression is nested too deeply.'],
  ])('explains why %s fails instead of evaluating it', async (expression, error) => {
    expect(await run('calculate', { expression })).toEqual({ ok: false, error });
  });
});

describe('convert_units', () => {
  it.each([
    [{ value: 10, from: 'km', to: 'mi' }, 6.213711922],
    [{ value: 72, from: 'kg', to: 'lb' }, 158.7329],
    [{ value: 100, from: 'C', to: 'F' }, 212],
    [{ value: 0, from: 'kelvin', to: 'celsius' }, -273.15],
    [{ value: 2, from: 'cups', to: 'ml' }, 473.176473],
    [{ value: 1, from: 'GiB', to: 'MB' }, 1073.741824],
  ])('converts %o', async (input, result) => {
    const outcome = await run('convert_units', input);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && (outcome.output as { result: number }).result).toBeCloseTo(result, 3);
  });

  it.each([
    [{ value: 3, from: 'km', to: 'cups' }, 'Cannot convert length (km) to volume (cup).'],
    [{ value: 3, from: 'parsec', to: 'km' }, 'Unknown unit "parsec".'],
    [{ value: 3, from: 'km', to: 'constructor' }, 'Unknown unit "constructor".'],
  ])('rejects %o', async (input, error) => {
    expect(await run('convert_units', input)).toEqual({ ok: false, error });
  });
});

describe('get_time', () => {
  it('uses the clock in the context and says when it is frozen', async () => {
    expect(await run('get_time', { timezone: 'Asia/Tokyo' })).toEqual({
      ok: true,
      output: {
        timezone: 'Asia/Tokyo',
        weekday: 'Tuesday',
        date: '2026-11-10',
        time: '18:30:00',
        utcOffset: '+09:00',
        clock: 'Frozen demo clock, not the real time',
      },
    });
  });

  it('rejects a name that is not a time zone', async () => {
    expect(await run('get_time', { timezone: 'Mars/Olympus' })).toEqual({
      ok: false,
      error: '"Mars/Olympus" is not an IANA time zone. Use a name like Europe/Oslo.',
    });
  });
});

describe('search_notes', () => {
  it.each([
    ['lentil soup', 'note-06'],
    ['Kyoto itinerary', 'note-17'],
    ['how do I feed my starter', 'note-01'],
    ['tire pressure bike', 'note-05'],
    ['accessibility forms', 'note-19'],
    ['Istanbul ferry', 'note-10'],
  ])('finds the right note first for %s', (query, id) => {
    expect(searchNotes(query, 3)[0]?.id).toBe(id);
  });

  it('returns nothing for words the notes do not use', () => {
    expect(searchNotes('quantum chromodynamics', 3)).toEqual([]);
  });
});

describe('lookup_weather', () => {
  it('labels fixture data as a sample', async () => {
    expect(await run('lookup_weather', { city: ' oslo ' })).toMatchObject({
      ok: true,
      output: { city: 'Oslo', sample: true, notice: 'Sample data, not a live forecast.' },
    });
  });

  it('lists the cities it has when it does not know one', async () => {
    const outcome = await run('lookup_weather', { city: 'Atlantis' });

    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('Sample cities: Amsterdam, Oslo'),
    });
  });
});

describe('tasks', () => {
  const existing: Task[] = [
    {
      id: 'task-1',
      title: 'Water plants',
      priority: 'low',
      done: true,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 'task-4',
      title: 'Book flights',
      priority: 'high',
      done: false,
      createdAt: '2026-11-02T00:00:00.000Z',
    },
  ];

  it('creates a task with the next id and a default priority, and never touches the list it was given', async () => {
    const outcome = await run(
      'create_task',
      { title: '  Renew passport ', due: '2026-12-01' },
      { ...context, tasks: existing },
    );

    expect(outcome).toEqual({
      ok: true,
      output: {
        created: {
          id: 'task-5',
          title: 'Renew passport',
          due: '2026-12-01',
          priority: 'normal',
          done: false,
          createdAt: '2026-11-10T09:30:00.000Z',
        },
      },
    });
    expect(existing).toHaveLength(2);
  });

  it.each([
    ['open', ['task-4']],
    ['done', ['task-1']],
    ['all', ['task-1', 'task-4']],
  ])('lists %s tasks', async (status, ids) => {
    const outcome = await run('list_tasks', { status }, { ...context, tasks: existing });

    expect(
      outcome.ok && (outcome.output as { tasks: Task[] }).tasks.map((task) => task.id),
    ).toEqual(ids);
  });
});

describe('tool definitions', () => {
  it('marks create_task as the only tool with side effects', () => {
    const names = [
      'calculate',
      'convert_units',
      'get_time',
      'search_notes',
      'create_task',
      'list_tasks',
      'lookup_weather',
    ];

    expect(names.filter((name) => findTool(name)?.sideEffect)).toEqual(['create_task']);
  });

  it('derives each input schema from the validator, so what the model sees is what is enforced', () => {
    const definition = toolDefinitions().find((entry) => entry.name === 'create_task');

    expect(definition?.input_schema).toMatchObject({
      type: 'object',
      required: ['title'],
      properties: { priority: { enum: ['low', 'normal', 'high'] } },
    });
  });

  it.each([
    ['create_task', { title: '' }],
    ['create_task', { title: 'x', due: 'next friday' }],
    ['calculate', {}],
    ['search_notes', { query: 'x', limit: 50 }],
  ])('rejects invalid input for %s', (name, input) => {
    const tool = findTool(name);
    if (!tool) throw new Error('missing tool');

    expect(validateInput(tool, input)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`Invalid input for ${name}`),
    });
  });
});
