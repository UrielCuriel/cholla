import { basename, dirname, join, relative, resolve } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import type { ChollaConfig, Profile } from './types.ts';

const START = '<!-- CHOLLA_START -->';
const END = '<!-- CHOLLA_END -->';
const TOML_START = '# CHOLLA_START';
const TOML_END = '# CHOLLA_END';

export type InitOptions = {
  repoRoot: string;
  projectName?: string;
  repository?: string;
  actor?: string;
  dryRun?: boolean;
  forceManaged?: boolean;
};

export type InitResult = {
  created: string[];
  updated: string[];
  unchanged: string[];
  collisions: string[];
};

const PROFILE_AREAS: Record<string, string[]> = {
  'product-owner': ['product', 'planning'],
  architect: ['architecture', 'contracts'],
  'knowledge-curator': ['knowledge'],
  'compiler-engineer': ['compiler', 'ir', 'contracts', 'modules'],
  'runtime-engineer': ['runtime', 'identity', 'authorization', 'audit'],
  'projection-engineer': ['api', 'database', 'ui', 'contracts'],
  'quality-engineer': ['quality', 'integration'],
};

function profile(id: string, actor: string): Profile {
  return {
    githubActors: { users: [actor], teams: [] },
    authority: [`Conceptual authority documented in .cholla/profiles/${id}.md`],
    responsibilities: [`Execute and coordinate ${id} work within persisted scope`],
    exclusions: ['Do not silently change product scope, shared contracts, or architectural invariants'],
    areas: PROFILE_AREAS[id] ?? [],
    knowledge: ['product', 'architecture', 'delivery'],
    instructions: [`.cholla/profiles/${id}.md`],
  };
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function discoverPaths(root: string, candidates: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of candidates) if (await exists(join(root, path))) found.push(path);
  return found;
}

export async function inferRepository(root: string): Promise<string | undefined> {
  const process = Bun.spawn(['git', 'remote', 'get-url', 'origin'], { cwd: root, stdout: 'pipe', stderr: 'ignore' });
  if (await process.exited !== 0) return undefined;
  const remote = (await new Response(process.stdout).text()).trim();
  return remote.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/)?.[1];
}

async function blueprintRoot(): Promise<string> {
  const candidates = [join(import.meta.dir, 'blueprint'), join(import.meta.dir, '..', 'blueprint')];
  for (const candidate of candidates) {
    try {
      if ((await readdir(candidate)).length) return candidate;
    } catch { /* try the development layout */ }
  }
  throw new Error('Embedded Cholla blueprint is unavailable');
}

async function filesBelow(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else result.push(relative(root, path));
  }
  return result;
}

function replaceBlock(original: string, block: string, start: string, end: string): string {
  const managed = `${start}\n${block.trim()}\n${end}`;
  const first = original.indexOf(start);
  const last = original.indexOf(end);
  if (first >= 0 && last >= first) {
    return `${original.slice(0, first)}${managed}${original.slice(last + end.length)}`;
  }
  return `${original.trimEnd()}${original.trim() ? '\n\n' : ''}${managed}\n`;
}

export async function initializeRepository(options: InitOptions): Promise<InitResult> {
  const root = resolve(options.repoRoot);
  const sourceRoot = await blueprintRoot();
  const result: InitResult = { created: [], updated: [], unchanged: [], collisions: [] };
  const write = async (path: string, content: string, managed = false): Promise<void> => {
    const absolute = join(root, path);
    const present = await exists(absolute);
    if (present && await Bun.file(absolute).text() === content) return void result.unchanged.push(path);
    if (present && !managed && !options.forceManaged) return void result.collisions.push(path);
    (present ? result.updated : result.created).push(path);
    if (!options.dryRun) {
      await mkdir(dirname(absolute), { recursive: true });
      await Bun.write(absolute, content);
    }
  };

  for (const path of await filesBelow(sourceRoot)) {
    if (path === 'AGENTS.md' || path === '.codex/config.toml') continue;
    const content = await Bun.file(join(sourceRoot, path)).text();
    if (/\.ya?ml$/.test(path)) Bun.YAML.parse(content);
    if (path.endsWith('.md')) Bun.markdown.html(content);
    await write(path, content);
  }

  const agentsSource = await Bun.file(join(sourceRoot, 'AGENTS.md')).text();
  Bun.markdown.html(agentsSource);
  const agentsPath = join(root, 'AGENTS.md');
  const agentsExisting = await exists(agentsPath) ? await Bun.file(agentsPath).text() : '';
  await write('AGENTS.md', replaceBlock(agentsExisting, agentsSource, START, END), true);

  const tomlSource = await Bun.file(join(sourceRoot, '.codex/config.toml')).text();
  Bun.TOML.parse(tomlSource);
  const tomlPath = join(root, '.codex/config.toml');
  const tomlExisting = await exists(tomlPath) ? await Bun.file(tomlPath).text() : '';
  if (tomlExisting && !tomlExisting.includes(TOML_START)) {
    const parsed = Bun.TOML.parse(tomlExisting) as Record<string, unknown>;
    const conflicts = Boolean(parsed.agents || parsed.mcp_servers);
    if (conflicts && !options.forceManaged) {
      result.collisions.push('.codex/config.toml');
    } else if (conflicts) {
      const managed = Bun.TOML.parse(tomlSource) as Record<string, unknown>;
      const merged = {
        ...parsed,
        agents: managed.agents,
        mcp_servers: {
          ...(parsed.mcp_servers as Record<string, unknown> | undefined),
          github: (managed.mcp_servers as Record<string, unknown>).github,
        },
      };
      const next = `${TOML_START}\n${(Bun.TOML.stringify(merged) ?? '').trim()}\n${TOML_END}\n`;
      Bun.TOML.parse(next);
      await write('.codex/config.toml', next, true);
    } else {
      const next = replaceBlock(tomlExisting, tomlSource, TOML_START, TOML_END);
      Bun.TOML.parse(next);
      await write('.codex/config.toml', next, true);
    }
  } else {
    const next = replaceBlock(tomlExisting, tomlSource, TOML_START, TOML_END);
    Bun.TOML.parse(next);
    await write('.codex/config.toml', next, true);
  }

  const productPaths = await discoverPaths(root, ['README.md', 'docs/README.md', 'docs/product/README.md', 'docs/north-star.md']);
  const architecturePaths = await discoverPaths(root, ['docs/architecture.md', 'docs/architecture/README.md', 'docs/adr/README.md', 'docs/internals/architectural-invariants.md']);
  const deliveryPaths = await discoverPaths(root, ['docs/roadmap.md', 'docs/mvp/README.md', 'docs/mvp/acceptance.md']);
  const actor = options.actor ?? '@me';
  const ids = Object.keys(PROFILE_AREAS);
  const config: ChollaConfig = {
    schemaVersion: 1,
    project: { name: options.projectName ?? basename(root), repository: options.repository ?? await inferRepository(root) },
    knowledge: { layers: [
      { id: 'product', purpose: 'Product identity, North Star, and outcomes', paths: productPaths, required: true },
      { id: 'architecture', purpose: 'Architecture, contracts, invariants, and decisions', paths: architecturePaths },
      { id: 'delivery', purpose: 'Current roadmap, milestone, and acceptance', paths: deliveryPaths },
    ] },
    profiles: Object.fromEntries(ids.map((id) => [id, profile(id, actor)])),
    github: {
      repository: options.repository ?? await inferRepository(root),
      activeMilestoneMarker: '<!-- cholla:active-milestone -->',
      taxonomy: { types: ['initiative', 'feature', 'task', 'spike', 'architecture', 'integration', 'quality', 'operations'], priorities: ['P0', 'P1', 'P2'] },
      labels: {
        ready: 'status:ready', inProgress: 'status:in-progress', blocked: 'status:blocked',
        needsDecision: 'status:needs-decision', handoffRequired: 'handoff:required',
        humanRequired: 'human:required', accepted: 'status:accepted', profilePrefix: 'profile:',
        areaPrefix: 'area:', typePrefix: 'type:', priorityPrefix: 'priority:',
      },
    },
    policy: { acceptanceProfile: 'quality-engineer', requireIndependentAcceptance: true, requireDistinctActor: false, claimTtlHours: 24 },
  };
  await write('.cholla/project.json', `${JSON.stringify(config, null, 2)}\n`);
  await write('.cholla/manifest.json', `${JSON.stringify({ schemaVersion: 1, preset: 'agentic-product', managedFiles: [...result.created, ...result.updated].sort() }, null, 2)}\n`, true);

  const ignorePath = join(root, '.gitignore');
  const ignoreExisting = await exists(ignorePath) ? await Bun.file(ignorePath).text() : '';
  await write('.gitignore', replaceBlock(ignoreExisting, '.cholla/local/\n.env.cholla', START, END), true);
  return result;
}
