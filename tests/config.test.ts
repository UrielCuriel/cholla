import { describe, expect, test } from 'bun:test';
import { validateConfig } from '../src/config.ts';
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
