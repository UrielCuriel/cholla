#!/usr/bin/env bun
import { createCLI, defineCommand, option } from '@bunli/core';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig, repositoryName } from './config.ts';
import { bootstrapLabels, GithubClient } from './github.ts';
import { initializeRepository } from './init.ts';
import {
  accept,
  acknowledgeHandoff,
  block,
  buildContext,
  claim,
  handoff,
  selectNext,
  unblock,
} from './work.ts';

const repositoryRoot = () => option(z.string().default('.'), {
  description: 'Repository root (default: current directory)',
});
const profile = () => option(z.string().min(1), { description: 'Cholla profile (required)' });
const issue = () => option(z.coerce.number().int().positive(), { description: 'GitHub issue number (required)' });
const text = (description: string) => option(z.string().min(1), { description: `${description} (required)` });
const flag = (description: string) => option(z.boolean().default(false), {
  description,
  argumentKind: 'flag',
});

async function project(repoRoot: string): Promise<{
  config: Awaited<ReturnType<typeof loadConfig>>;
  client: GithubClient;
}> {
  const config = await loadConfig(repoRoot);
  return { config, client: new GithubClient(repositoryName(config)) };
}

async function main(): Promise<void> {
  const cli = await createCLI({
    name: 'cholla',
    version: '0.1.0',
    description: 'Control plane for coordinating independent Codex sessions through GitHub',
    generated: false,
  });

  cli.command(defineCommand({
    name: 'init',
    description: 'Initialize Cholla in a repository',
    options: {
      repository: option(z.string().optional(), { description: 'GitHub repository (owner/name)' }),
      project: option(z.string().optional(), { description: 'Project name' }),
      actor: option(z.string().optional(), { description: 'GitHub actor login' }),
      'apply-github': flag('Create or update configured GitHub labels'),
      'dry-run': flag('Report changes without writing them'),
      'force-managed': flag('Replace conflicting Cholla-managed files'),
      'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const repoRoot = resolve(flags['repo-root']);
      const result = await initializeRepository({
        repoRoot,
        projectName: flags.project,
        repository: flags.repository,
        actor: flags.actor,
        dryRun: flags['dry-run'],
        forceManaged: flags['force-managed'],
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.collisions.length) console.log('Preserved collisions; review them or rerun with --force-managed.');
      if (flags['apply-github'] && !flags['dry-run']) {
        const initialized = await loadConfig(repoRoot);
        const labels = await bootstrapLabels(new GithubClient(repositoryName(initialized)), initialized);
        console.log(`Reconciled ${labels.length} GitHub labels`);
      }
    },
  }));

  cli.command(defineCommand({
    name: 'codex',
    description: 'Start Codex with the GitHub token supplied by gh',
    options: { 'repo-root': repositoryRoot() },
    handler: async ({ flags, positional }) => {
      const tokenProcess = Bun.spawn(['gh', 'auth', 'token'], { stdout: 'pipe', stderr: 'pipe' });
      const [token, stderr, exitCode] = await Promise.all([
        new Response(tokenProcess.stdout).text(), new Response(tokenProcess.stderr).text(), tokenProcess.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr.trim() || 'Unable to obtain a GitHub token from gh');
      const child = Bun.spawn(['codex', '--cd', resolve(flags['repo-root']), ...positional], {
        stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
        env: { ...Bun.env, GITHUB_PAT_TOKEN: token.trim() },
      });
      process.exitCode = await child.exited;
    },
  }));

  cli.command(defineCommand({
    name: 'bootstrap-labels',
    description: 'Create or update the configured GitHub labels',
    options: { 'repo-root': repositoryRoot() },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      const labels = await bootstrapLabels(client, config);
      console.log(`Reconciled ${labels.length} configured labels`);
    },
  }));

  cli.command(defineCommand({
    name: 'doctor',
    description: 'Check GitHub authentication and the active milestone',
    options: { 'repo-root': repositoryRoot() },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await client.authStatus();
      const milestone = await client.activeMilestone(config.github.activeMilestoneMarker);
      console.log(`OK ${config.project.name}; active milestone: ${milestone.title}`);
    },
  }));

  cli.command(defineCommand({
    name: 'context',
    description: 'Build the repository and GitHub context for a profile',
    options: { profile: profile(), 'repo-root': repositoryRoot() },
    handler: async ({ flags }) => {
      const repoRoot = resolve(flags['repo-root']);
      const { config, client } = await project(repoRoot);
      console.log(await buildContext(repoRoot, flags.profile, config, client));
    },
  }));

  cli.command(defineCommand({
    name: 'next',
    description: 'List eligible work for a profile',
    options: { profile: profile(), 'repo-root': repositoryRoot() },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      const issues = selectNext(await client.issues(), flags.profile, config);
      console.log(issues.length ? JSON.stringify(issues, null, 2) : 'No eligible work');
    },
  }));

  cli.command(defineCommand({
    name: 'claim',
    description: 'Request a lease for an issue',
    options: { profile: profile(), issue: issue(), session: text('Codex session ID'), 'repo-root': repositoryRoot() },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await claim(client, flags.issue, flags.profile, config, flags.session);
      console.log(`Lease request submitted for #${flags.issue}; do not edit until the coordinator posts lease-granted`);
    },
  }));

  cli.command(defineCommand({
    name: 'handoff',
    description: 'Record a structured handoff to another profile',
    options: {
      profile: profile(), issue: issue(), to: text('Receiving profile'), type: text('Handoff type'),
      context: text('Relevant context'), impact: text('Impact of the handoff'), action: text('Required action'),
      blocking: text('Blocking condition'), evidence: text('Supporting evidence'), related: text('Related work'),
      state: option(z.enum(['ready', 'blocked', 'needs-decision']).optional(), {
        description: 'Optional target state; supports needs-decision to ready',
      }),
      'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await handoff(client, flags.issue, {
        from: flags.profile, to: flags.to, type: flags.type, context: flags.context, impact: flags.impact,
        requiredAction: flags.action, blockingCondition: flags.blocking, evidence: flags.evidence,
        relatedWork: flags.related,
      }, config, flags.state);
    },
  }));

  cli.command(defineCommand({
    name: 'handoff-ack',
    description: 'Acknowledge a pending handoff as its receiving profile',
    options: {
      profile: profile(),
      issue: issue(),
      state: option(z.enum(['ready', 'blocked', 'needs-decision']), {
        description: 'Persisted target state: ready, blocked, or needs-decision (required)',
      }),
      'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await acknowledgeHandoff(client, flags.issue, flags.profile, flags.state, config);
    },
  }));

  cli.command(defineCommand({
    name: 'block',
    description: 'Record a blocker on an issue',
    options: {
      profile: profile(), issue: issue(), condition: text('Failed condition'),
      dependency: text('Dependency or owner'), evidence: text('Supporting evidence'),
      'next-check': text('When or how to check again'), 'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await block(client, flags.issue, {
        profile: flags.profile, condition: flags.condition, dependency: flags.dependency,
        evidence: flags.evidence, nextCheck: flags['next-check'],
      }, config);
    },
  }));

  cli.command(defineCommand({
    name: 'unblock',
    description: 'Record an evidenced blocker resolution and move blocked work to ready',
    options: {
      profile: profile(), issue: issue(), session: text('Codex session ID'),
      resolution: text('Blocker resolution'), evidence: text('Supporting evidence'),
      'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await unblock(client, flags.issue, {
        profile: flags.profile,
        sessionId: flags.session,
        resolution: flags.resolution,
        evidence: flags.evidence,
      }, config);
    },
  }));

  cli.command(defineCommand({
    name: 'accept',
    description: 'Record independent acceptance of an issue',
    options: {
      profile: profile(), issue: issue(), evidence: text('Acceptance evidence'),
      session: text('Codex session ID'), 'repo-root': repositoryRoot(),
    },
    handler: async ({ flags }) => {
      const { config, client } = await project(resolve(flags['repo-root']));
      await accept(client, flags.issue, flags.profile, flags.evidence, config, flags.session);
    },
  }));

  const args = Bun.argv.slice(2);
  const normalizedArgs = args[0] === 'help' ? [...args.slice(1), '--help'] : args;
  const hasExplicitFormat = normalizedArgs.some((arg) => arg === '--format' || arg.startsWith('--format='));
  await cli.run(hasExplicitFormat ? normalizedArgs : ['--format', 'toon', ...normalizedArgs]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
