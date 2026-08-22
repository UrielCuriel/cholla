#!/usr/bin/env bun
import { resolve } from 'node:path';
import { loadConfig, repositoryName } from './config.ts';
import { bootstrapLabels, GithubClient } from './github.ts';
import { accept, block, buildContext, claim, handoff, selectNext } from './work.ts';

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const candidate = index >= 0 ? args[index + 1] : undefined;
  return candidate && !candidate.startsWith('--') ? candidate : undefined;
}

function required(args: string[], flag: string): string {
  const result = value(args, flag);
  if (!result) throw new Error(`Missing ${flag}`);
  return result;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const command = args.shift() ?? 'help';
  const repoRoot = resolve(value(args, '--repo-root') ?? '.');
  if (command === 'help') {
    console.log('cholla doctor|bootstrap-labels|context|next|claim|handoff|block|accept [options]');
    return;
  }
  const known = new Set(['doctor', 'bootstrap-labels', 'context', 'next', 'claim', 'handoff', 'block', 'accept']);
  if (!known.has(command)) throw new Error(`Unknown command: ${command}`);
  const config = await loadConfig(repoRoot);
  const client = new GithubClient(repositoryName(config));
  if (command === 'bootstrap-labels') {
    const labels = await bootstrapLabels(client, config);
    console.log(`Reconciled ${labels.length} configured labels`);
    return;
  }
  if (command === 'doctor') {
    await client.authStatus();
    const milestone = await client.activeMilestone(config.github.activeMilestoneMarker);
    console.log(`OK ${config.project.name}; active milestone: ${milestone.title}`);
    return;
  }
  const profile = required(args, '--profile');
  if (command === 'context') {
    console.log(await buildContext(repoRoot, profile, config, client));
    return;
  }
  const milestone = await client.activeMilestone(config.github.activeMilestoneMarker);
  if (command === 'next') {
    const issues = selectNext(await client.issues(milestone.title), profile, config);
    console.log(issues.length ? JSON.stringify(issues, null, 2) : 'No eligible work');
    return;
  }
  const number = Number(required(args, '--issue'));
  if (!Number.isInteger(number) || number <= 0) throw new Error('--issue must be a positive integer');
  if (command === 'claim') {
    await claim(client, number, profile, config, required(args, '--session'));
    console.log(`Lease request submitted for #${number}; do not edit until the coordinator posts lease-granted`);
  } else if (command === 'handoff') {
    await handoff(client, number, {
      from: profile,
      to: required(args, '--to'),
      type: required(args, '--type'),
      context: required(args, '--context'),
      impact: required(args, '--impact'),
      requiredAction: required(args, '--action'),
      blockingCondition: required(args, '--blocking'),
      evidence: required(args, '--evidence'),
      relatedWork: required(args, '--related'),
    }, config);
  } else if (command === 'block') {
    await block(client, number, {
      profile,
      condition: required(args, '--condition'),
      dependency: required(args, '--dependency'),
      evidence: required(args, '--evidence'),
      nextCheck: required(args, '--next-check'),
    }, config);
  } else if (command === 'accept') {
    await accept(client, number, profile, required(args, '--evidence'), config);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
