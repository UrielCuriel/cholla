import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { GithubClient } from '../src/github.ts';
import {
  accept,
  acknowledgeHandoff,
  block,
  buildContext,
  claim,
  handoff,
  selectNext,
} from '../src/work.ts';
import { config, issue } from './fixtures.ts';

class FakeClient {
  current = issue();
  comments: string[] = [];
  edits: { add: string[]; remove: string[] }[] = [];
  actor = 'quality';
  failNextEdit = false;
  async issue(): Promise<ReturnType<typeof issue>> { return this.current; }
  async activeMilestone(): Promise<{ number: number; title: string; state: string }> {
    return { number: 1, title: 'M1', state: 'open' };
  }
  async issues(): Promise<ReturnType<typeof issue>[]> { return [this.current]; }
  async comment(_number: number, body: string): Promise<void> { this.comments.push(body); }
  async currentActor(): Promise<string> { return this.actor; }
  async editLabels(_number: number, add: string[], remove: string[]): Promise<void> {
    if (this.failNextEdit) {
      this.failNextEdit = false;
      throw new Error('partial GitHub mutation');
    }
    this.edits.push({ add, remove });
    const names = new Set(this.current.labels.map(({ name }) => name));
    for (const label of add) names.add(label);
    for (const label of remove) names.delete(label);
    this.current = { ...this.current, labels: [...names].map((name) => ({ name })) };
  }
}

const handoffFields = (to = 'builder') => ({
  from: 'quality', to, type: 'implementation', context: 'context', impact: 'impact',
  requiredAction: 'act', blockingCondition: 'none', evidence: 'evidence', relatedWork: '#1',
});

const handoffBody = (to = 'builder') => `<!-- cholla:handoff:v1 -->
\`\`\`json
${JSON.stringify(handoffFields(to), null, 2)}
\`\`\``;

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

describe('handoff projection', () => {
  test('preserves an existing receiver with disjoint label mutations', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:builder', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.comments[0]).toContain('cholla:handoff:v1');
    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: [] }]);
    expect(fake.current.labels.map(({ name }) => name)).toEqual([
      's:ready', 'p:builder', 'priority:P1', 'handoff',
    ]);
  });

  test('replaces only stale profile labels and preserves unrelated state', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:quality', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: ['p:quality'] }]);
    expect(fake.current.labels.map(({ name }) => name)).toEqual([
      's:blocked', 'priority:P1', 'handoff', 'p:builder',
    ]);
  });

  test('repairs multiple profile labels while retaining the receiver', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:quality', 'p:builder', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: ['p:quality'] }]);
    expect(fake.current.labels.filter(({ name }) => name.startsWith('p:')))
      .toEqual([{ name: 'p:builder' }]);
  });

  test('converges on retry without ever removing the receiver', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:builder', 'priority:P1']);
    fake.failNextEdit = true;

    await expect(handoff(fake as unknown as GithubClient, 1, handoffFields(), config))
      .rejects.toThrow('partial GitHub mutation');
    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);
    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.comments).toHaveLength(3);
    expect(fake.edits).toEqual([
      { add: ['handoff', 'p:builder'], remove: [] },
      { add: ['handoff', 'p:builder'], remove: [] },
    ]);
    for (const edit of fake.edits) {
      expect(edit.add.filter((label) => edit.remove.includes(label))).toEqual([]);
    }
    expect(fake.current.labels.map(({ name }) => name)).toContain('p:builder');
    expect(fake.current.labels.map(({ name }) => name)).toContain('handoff');
  });
});

describe('handoff acknowledgment', () => {
  test('moves a valid ready handoff into eligible work without altering its event', async () => {
    const fake = new FakeClient();
    const original = handoffBody();
    fake.current = issue(['s:ready', 'p:builder', 'handoff', 'priority:P1']);
    fake.current.comments = [{ body: original, createdAt: new Date().toISOString(), author: { login: 'quality' } }];

    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config);

    expect(fake.comments[0]).toContain('cholla:handoff-ack:v1');
    expect(fake.comments[0]).toContain('handoff-acknowledged');
    expect(fake.current.comments[0]?.body).toBe(original);
    expect(fake.edits).toEqual([{ add: [], remove: ['handoff'] }]);
    expect(selectNext([fake.current], 'builder', config)).toHaveLength(1);
    const context = await buildContext(
      resolve(import.meta.dir, '..'),
      'builder',
      config,
      fake as unknown as GithubClient,
    );
    expect(context).toContain('Pending handoffs:\n- None');
    expect(context).toContain('Eligible new work:\n- #1 Work');
    await claim(fake as unknown as GithubClient, 1, 'builder', config, 'receiver-session');
    expect(fake.comments.at(-1)).toContain('lease-requested');
  });

  test('rejects a profile other than the persisted receiver', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:quality', 'handoff']);
    fake.current.comments = [{ body: handoffBody('quality'), createdAt: new Date().toISOString(), author: null }];
    expect(acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config))
      .rejects.toThrow('Handoff receiver is quality, not builder');
  });

  test('requires the explicit target state to already be persisted', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder', 'handoff']);
    fake.current.comments = [{ body: handoffBody(), createdAt: new Date().toISOString(), author: null }];
    expect(acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config))
      .rejects.toThrow('target state ready is not present');
  });

  test('rejects a historical handoff that is not pending or already acknowledged', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:builder']);
    fake.current.comments = [{ body: handoffBody(), createdAt: new Date().toISOString(), author: null }];
    expect(acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config))
      .rejects.toThrow('no pending handoff');
  });

  test('preserves blocked work while acknowledging its handoff', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder', 'handoff']);
    fake.current.comments = [{ body: handoffBody(), createdAt: new Date().toISOString(), author: null }];
    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'blocked', config);
    expect(fake.current.labels.map(({ name }) => name)).toContain('s:blocked');
    expect(selectNext([fake.current], 'builder', config)).toEqual([]);
  });

  test('is idempotent and repairs a partial comment-before-label mutation', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:ready', 'p:builder', 'handoff']);
    fake.current.comments = [{ body: handoffBody(), createdAt: new Date().toISOString(), author: null }];
    fake.failNextEdit = true;
    await expect(acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config))
      .rejects.toThrow('partial GitHub mutation');
    fake.current.comments!.push({
      body: fake.comments[0]!, createdAt: new Date().toISOString(), author: { login: 'builder' },
    });

    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config);
    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config);

    expect(fake.comments).toHaveLength(1);
    expect(fake.edits).toEqual([{ add: [], remove: ['handoff'] }]);
  });
});

describe('acceptance', () => {
  test('rejects a profile that is not the configured verifier', async () => {
    const fake = new FakeClient();
    expect(accept(fake as unknown as GithubClient, 1, 'builder', 'tests', config, 'qa-session'))
      .rejects.toThrow('Acceptance requires profile quality');
  });

  test('records acceptance by the authorized profile', async () => {
    const fake = new FakeClient();
    await accept(fake as unknown as GithubClient, 1, 'quality', 'bun test', config, 'qa-session');
    expect(fake.comments[0]).toContain('cholla:acceptance:v1');
    expect(fake.edits).toHaveLength(1);
  });

  test('rejects the implementing session even under the verifier profile', async () => {
    const fake = new FakeClient();
    fake.current.comments = [{
      body: '<!-- cholla:claim:v1 -->\n```json\n{"sessionId": "same-session"}\n```', createdAt: new Date().toISOString(), author: { login: 'quality' },
    }];
    expect(accept(fake as unknown as GithubClient, 1, 'quality', 'bun test', config, 'same-session'))
      .rejects.toThrow('different Codex session');
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
