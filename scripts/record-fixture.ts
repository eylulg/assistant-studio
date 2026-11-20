/**
 * Records a real answer into evals/transcripts so demo mode and the evals replay it.
 * This calls the Anthropic API and spends tokens: one run, plus a second one when the
 * prompt needs approval, to record what the model says after a denial.
 *
 *   ANTHROPIC_API_KEY=... npm run record-fixture -- "What is 12% of 340?"
 *   ANTHROPIC_API_KEY=... npm run record-fixture -- "Add a task to call the bank" --suggested
 *
 * Tools run against the frozen demo clock, so the recorded answer matches what replay shows.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, writeFileSync } from 'node:fs';
import { CASES } from '../evals/cases';
import type { EvalCase } from '../evals/cases';
import { runCase } from '../evals/harness';
import { buildTranscript, createRecorder, transcriptIndexSource } from '../evals/recorder';
import { serverConfig } from '../src/lib/config';
import { createAnthropicClient } from '../src/lib/engine/anthropic-client';
import { slugify } from '../src/lib/engine/transcripts';
import { findTool } from '../src/lib/tools';

const DIRECTORY = new URL('../evals/transcripts/', import.meta.url);

async function record(
  prompt: string,
  approval: 'approve' | 'deny',
  model: string,
  apiKey: string,
  effort: ReturnType<typeof serverConfig>['effort'],
) {
  const recorder = createRecorder(createAnthropicClient(new Anthropic({ apiKey }), effort));
  const testCase: EvalCase = {
    id: 'record',
    label: 'Record',
    prompt,
    approval,
    expect: { tools: [], answer: {} },
  };
  const run = await runCase(testCase, {
    client: recorder.client,
    model,
    clock: 'frozen',
    maxOutputTokens: 4096,
  });
  return {
    rounds: recorder.rounds,
    usedApproval: run.tools.some((tool) => findTool(tool.name)?.sideEffect),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const prompt = args.find((arg) => !arg.startsWith('--'));
  if (!prompt) throw new Error('Usage: npm run record-fixture -- "<prompt>" [--suggested]');
  const config = serverConfig();
  if (!config.apiKey) throw new Error('Set ANTHROPIC_API_KEY to record a fixture.');
  const model = config.defaultModel;

  console.log(`Recording "${prompt}" with ${model}`);
  const approved = await record(prompt, 'approve', model, config.apiKey, config.effort);
  let denied;
  if (approved.usedApproval) {
    console.log('The prompt asked for approval. Recording the denied path as well.');
    const second = await record(prompt, 'deny', model, config.apiKey, config.effort);
    denied = second.rounds.at(-1);
  }

  const transcript = buildTranscript({
    prompt,
    model,
    rounds: approved.rounds,
    denied,
    suggested: args.includes('--suggested'),
    date: new Date().toISOString().slice(0, 10),
  });
  writeFileSync(
    new URL(`${transcript.id}.json`, DIRECTORY),
    `${JSON.stringify(transcript, null, 2)}\n`,
  );

  const ids = readdirSync(DIRECTORY)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
  writeFileSync(new URL('index.ts', DIRECTORY), transcriptIndexSource(ids));

  const known = CASES.some((testCase) => slugify(testCase.prompt) === transcript.id);
  console.log(`Wrote evals/transcripts/${transcript.id}.json and updated the index.`);
  if (!known)
    console.log('No eval case uses this prompt yet. Add one to evals/cases.ts to assert on it.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
