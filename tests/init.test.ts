import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeRepository } from '../src/init.ts';
import { loadConfig } from '../src/config.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cholla-init-'));
  roots.push(root);
  await Bun.write(join(root, 'README.md'), '# Consumer product\n');
  await Bun.write(join(root, 'AGENTS.md'), '# Existing instructions\n');
  return root;
}

describe('init', () => {
  test('installs a complete, parseable Codex control plane while preserving instructions', async () => {
    const root = await repository();
    const result = await initializeRepository({ repoRoot: root, repository: 'acme/product', actor: 'agent' });
    expect(result.collisions).toEqual([]);
    expect(Object.keys((await loadConfig(root)).profiles)).toHaveLength(7);
    expect(await Bun.file(join(root, '.codex/agents/product-owner.toml')).exists()).toBeTrue();
    expect(await Bun.file(join(root, '.agents/skills/cholla-product-owner/SKILL.md')).exists()).toBeTrue();
    expect(Bun.YAML.parse(await Bun.file(join(root, '.github/ISSUE_TEMPLATE/capability.yml')).text()))
      .toHaveProperty('name', 'Capability');
    const agents = await Bun.file(join(root, 'AGENTS.md')).text();
    expect(agents).toContain('# Existing instructions');
    expect(agents.match(/CHOLLA_START/g)).toHaveLength(1);
    const toml = await Bun.file(join(root, '.codex/config.toml')).text();
    expect(Bun.TOML.parse(toml)).toHaveProperty('mcp_servers.github');
    expect(Bun.markdown.html(agents)).toContain('Existing instructions');
  });

  test('is idempotent and preserves customized project configuration', async () => {
    const root = await repository();
    await initializeRepository({ repoRoot: root, repository: 'acme/product' });
    const configPath = join(root, '.cholla/project.json');
    const customized = (await Bun.file(configPath).text()).replace('"claimTtlHours": 24', '"claimTtlHours": 12');
    await Bun.write(configPath, customized);
    const result = await initializeRepository({ repoRoot: root, repository: 'acme/product' });
    expect(result.collisions).toContain('.cholla/project.json');
    expect(await Bun.file(configPath).text()).toContain('"claimTtlHours": 12');
    expect((await Bun.file(join(root, 'AGENTS.md')).text()).match(/CHOLLA_START/g)).toHaveLength(1);
  });

  test('reports its plan without writing in dry-run mode', async () => {
    const root = await repository();
    const result = await initializeRepository({ repoRoot: root, repository: 'acme/product', dryRun: true });
    expect(result.created).toContain('.cholla/project.json');
    expect(await Bun.file(join(root, '.cholla/project.json')).exists()).toBeFalse();
  });

  test('uses Bun TOML merge when explicitly replacing conflicting Codex sections', async () => {
    const root = await repository();
    await Bun.write(join(root, '.codex/config.toml'), '[agents]\nenabled = false\n\n[features]\nexperimental = true\n');
    await initializeRepository({ repoRoot: root, repository: 'acme/product', forceManaged: true });
    const parsed = Bun.TOML.parse(await Bun.file(join(root, '.codex/config.toml')).text()) as any;
    expect(parsed.agents.enabled).toBeTrue();
    expect(parsed.features.experimental).toBeTrue();
    expect(parsed.mcp_servers.github.url).toContain('githubcopilot.com');
  });
});
