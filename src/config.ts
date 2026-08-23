import { resolve } from 'node:path';
import type { ChollaConfig } from './types.ts';

export const CONFIG_PATH = '.cholla/project.json';
export const CONFIG_JSON5_PATH = '.cholla/project.json5';

export async function loadConfig(repoRoot: string): Promise<ChollaConfig> {
  const path = resolve(repoRoot, CONFIG_PATH);
  const file = Bun.file(path);
  const json5File = Bun.file(resolve(repoRoot, CONFIG_JSON5_PATH));
  if (!(await file.exists()) && !(await json5File.exists())) {
    throw new Error(`Missing ${CONFIG_PATH} or ${CONFIG_JSON5_PATH} in ${repoRoot}`);
  }
  const config = await file.exists()
    ? await file.json() as ChollaConfig
    : Bun.JSON5.parse(await json5File.text()) as ChollaConfig;
  validateConfig(config);
  return config;
}

export function validateConfig(config: ChollaConfig): void {
  if (config.schemaVersion !== 1) throw new Error('Unsupported Cholla schemaVersion');
  if (!config.project?.name) throw new Error('project.name is required');
  if (!config.knowledge?.layers?.length) throw new Error('knowledge.layers cannot be empty');
  if (!config.profiles || Object.keys(config.profiles).length === 0) {
    throw new Error('At least one profile is required');
  }
  for (const [id, profile] of Object.entries(config.profiles)) {
    if (!profile.githubActors || (!profile.githubActors.users.length && !profile.githubActors.teams.length)) {
      throw new Error(`profiles.${id}.githubActors must authorize at least one user or team`);
    }
    if (!profile.authority?.length) throw new Error(`profiles.${id}.authority cannot be empty`);
    if (!profile.responsibilities?.length) {
      throw new Error(`profiles.${id}.responsibilities cannot be empty`);
    }
  }
  const requiredLabelKeys = [
    'ready', 'inProgress', 'blocked', 'needsDecision', 'handoffRequired', 'humanRequired',
    'accepted', 'profilePrefix', 'areaPrefix', 'typePrefix', 'priorityPrefix',
  ] as const;
  const labels = config.github?.labels;
  if (!labels || requiredLabelKeys.some((key) => !labels[key])) {
    throw new Error('github.labels must define all workflow labels and prefixes');
  }
  if (!config.github.taxonomy?.types.length || !config.github.taxonomy?.priorities.length) {
    throw new Error('github.taxonomy must define work types and ordered priorities');
  }
  if (!Number.isFinite(config.policy?.claimTtlHours) || config.policy.claimTtlHours <= 0) {
    throw new Error('policy.claimTtlHours must be positive');
  }
}

export function repositoryName(config: ChollaConfig): string {
  const name = config.github.repository ?? config.project.repository;
  if (!name) throw new Error('Configure github.repository as owner/name');
  return name;
}
