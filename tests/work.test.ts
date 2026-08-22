import { describe, expect, test } from 'bun:test';
import type { GithubClient } from '../src/github.ts';
import { accept, block, claim, selectNext } from '../src/work.ts';
import { config, issue } from './fixtures.ts';

class FakeClient {
  current = issue();
  comments: string[] = [];
  edits: unknown[] = [];
  actor = 'quality';
  async issue(): Promise<ReturnType<typeof issue>> { return this.current; }
  async comment(_number: number, body: string): Promise<void> { this.comments.push(body); }
  async currentActor(): Promise<string> { return this.actor; }
  async editLabels(_number: number, add: string[], remove: string[]): Promise<void> {
    this.edits.push({ add, remove });
  }
}

describe('eligibility', () => {
  test('orders eligible work by priority', () => {
    const p1 = issue();
    const p0 = { ...issue(['s:ready', 'p:builder', 'priority:P0']), number: 2 };
    expect(selectNext([p1, p0], 'builder', config).map(({ number }) => number)).toEqual([2, 1]);
  });

  test.each(['s:doing', 's:blocked', 's:decision', 'handoff', 'human', 's:accepted']) (
    'excludes conflicting state %s',
    (state) => {
      expect(selectNext([issue(['s:ready', 'p:builder', state])], 'builder', config)).toEqual([]);
    },
  );
});

describe('leases', () => {
  test('posts a request but never self-grants through non-atomic edits', async () => {
    const fake = new FakeClient();
    await claim(fake as unknown as GithubClient, 1, 'builder', config, 'session-1');
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]).toContain('lease-requested');
    expect(fake.edits).toEqual([]);
  });
});

describe('acceptance', () => {
  test('rejects a profile that is not the configured verifier', async () => {
    const fake = new FakeClient();
    expect(accept(fake as unknown as GithubClient, 1, 'builder', 'tests', config))
      .rejects.toThrow('Acceptance requires profile quality');
  });

  test('records acceptance by the authorized profile', async () => {
    const fake = new FakeClient();
    await accept(fake as unknown as GithubClient, 1, 'quality', 'bun test', config);
    expect(fake.comments[0]).toContain('cholla:acceptance:v1');
    expect(fake.edits).toHaveLength(1);
  });

  test('rejects the same GitHub actor even under the verifier profile', async () => {
    const fake = new FakeClient();
    fake.current.comments = [{
      body: '<!-- cholla:claim:v1 -->', createdAt: new Date().toISOString(), author: { login: 'quality' },
    }];
    expect(accept(fake as unknown as GithubClient, 1, 'quality', 'bun test', config))
      .rejects.toThrow('implementing actor');
  });
});

test('a blocker persists evidence and removes executable states', async () => {
  const fake = new FakeClient();
  await block(fake as unknown as GithubClient, 1, {
    profile: 'builder', condition: 'contract missing', dependency: '#2',
    evidence: 'check failed', nextCheck: 'after #2',
  }, config);
  expect(fake.comments[0]).toContain('cholla:blocker:v1');
  expect(fake.edits[0]).toEqual({ add: ['s:blocked'], remove: ['s:ready', 's:doing'] });
});
