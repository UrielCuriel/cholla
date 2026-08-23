import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, validateConfig } from '../src/config.ts';
import { config } from './fixtures.ts';

describe('project contract', () => {
  test('accepts a complete product-owned configuration', () => {
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('rejects a missing semantic label key', () => {
    const broken = structuredClone(config) as unknown as Record<string, any>;
    delete broken.github.labels.ready;
    expect(() => validateConfig(broken as any)).toThrow('github.labels');
  });
});

test('loads an optional human-authored JSON5 project contract with Bun native parsing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cholla-json5-'));
  try {
    const source = JSON.stringify(config, null, 2)
      .replace(/^\{/, '{ // JSON5 comments are allowed')
      .replace(/\n\}$/, ',\n}');
    await Bun.write(join(root, '.cholla/project.json5'), source);
    expect((await loadConfig(root)).project.name).toBe('Test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
