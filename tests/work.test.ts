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
  unblock,
} from '../src/work.ts';
import { config, issue } from './fixtures.ts';

class FakeClient {
  current = issue();
  allIssues?: ReturnType<typeof issue>[];
  comments: string[] = [];
  edits: { add: string[]; remove: string[] }[] = [];
  actor = 'builder';
  failNextComment = false;
  failNextEdit: 'before' | 'after' | false = false;
  appendBlockerAfterUnblock = false;
  teamAuthorized = false;
  async issue(): Promise<ReturnType<typeof issue>> { return this.current; }
  async activeMilestone(): Promise<{ number: number; title: string; state: string }> {
    return { number: 1, title: 'M1', state: 'open' };
  }
  async issues(milestone?: string): Promise<ReturnType<typeof issue>[]> {
    return milestone ? [this.current] : (this.allIssues ?? [this.current]);
  }
  async comment(_number: number, body: string): Promise<void> {
    if (this.failNextComment) {
      this.failNextComment = false;
      throw new Error('comment failed');
    }
    this.comments.push(body);
    this.current.comments ??= [];
    this.current.comments.push({
      body, createdAt: new Date().toISOString(), author: { login: this.actor },
    });
    if (this.appendBlockerAfterUnblock && body.startsWith('<!-- cholla:unblock:v1 -->')) {
      this.current.comments.push({
        body: blockerBody('new blocker during transition'),
        createdAt: new Date().toISOString(), author: null,
      });
    }
  }
  async currentActor(): Promise<string> { return this.actor; }
  async actorInAnyTeam(): Promise<boolean> { return this.teamAuthorized; }
  async editLabels(_number: number, add: string[], remove: string[]): Promise<void> {
    if (this.failNextEdit === 'before') {
      this.failNextEdit = false;
      throw new Error('partial GitHub mutation');
    }
    this.edits.push({ add, remove });
    const names = new Set(this.current.labels.map(({ name }) => name));
    for (const label of add) names.add(label);
    for (const label of remove) names.delete(label);
    this.current = { ...this.current, labels: [...names].map((name) => ({ name })) };
    if (this.failNextEdit === 'after') {
      this.failNextEdit = false;
      throw new Error('transport failed after mutation');
    }
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

function authorizedHandoffClient(): FakeClient {
  const fake = new FakeClient();
  fake.actor = 'quality';
  return fake;
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

  test('includes eligible work outside the active milestone in context', async () => {
    const fake = new FakeClient();
    const outside = { ...issue(), number: 2, milestone: null };
    fake.allIssues = [fake.current, outside];

    const context = await buildContext(
      resolve(import.meta.dir, '..'), 'builder', config, fake as unknown as GithubClient,
    );

    expect(context).toContain('Active milestone: M1');
    expect(context).toContain('#2 Work');
  });
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
  test('promotes an authorized needs-decision handoff to ready', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:decision', 'p:builder', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config, 'ready');

    expect(fake.comments[0]).toContain('"targetState": "ready"');
    expect(fake.edits).toEqual([{
      add: ['handoff', 'p:builder', 's:ready'],
      remove: ['s:decision'],
    }]);
  });

  test('rejects an unauthorized sender without mutation', async () => {
    const fake = authorizedHandoffClient();
    fake.actor = 'intruder';
    await expect(handoff(fake as unknown as GithubClient, 1, handoffFields(), config, 'ready'))
      .rejects.toThrow('is not authorized for profile quality');
    expect(fake.comments).toEqual([]);
    expect(fake.edits).toEqual([]);
  });

  test('rejects unsupported state transitions without mutation', async () => {
    const fake = authorizedHandoffClient();
    await expect(handoff(fake as unknown as GithubClient, 1, handoffFields(), config, 'blocked'))
      .rejects.toThrow('Unsupported handoff state transition: ready -> blocked');
    expect(fake.comments).toEqual([]);
    expect(fake.edits).toEqual([]);
  });

  test('reuses the pending event while repairing a failed state projection', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:decision', 'p:builder']);
    fake.failNextEdit = 'before';
    await expect(handoff(fake as unknown as GithubClient, 1, handoffFields(), config, 'ready'))
      .rejects.toThrow('partial GitHub mutation');
    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config, 'ready');

    expect(fake.comments).toHaveLength(1);
    expect(fake.current.labels.map(({ name }) => name)).toContain('s:ready');
    expect(fake.current.labels.map(({ name }) => name)).not.toContain('s:decision');
  });

  test('preserves an existing receiver with disjoint label mutations', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:ready', 'p:builder', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.comments[0]).toContain('cholla:handoff:v1');
    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: [] }]);
    expect(fake.current.labels.map(({ name }) => name)).toEqual([
      's:ready', 'p:builder', 'priority:P1', 'handoff',
    ]);
  });

  test('replaces only stale profile labels and preserves unrelated state', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:blocked', 'p:quality', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: ['p:quality'] }]);
    expect(fake.current.labels.map(({ name }) => name)).toEqual([
      's:blocked', 'priority:P1', 'handoff', 'p:builder',
    ]);
  });

  test('repairs multiple profile labels while retaining the receiver', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:ready', 'p:quality', 'p:builder', 'priority:P1']);

    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.edits).toEqual([{ add: ['handoff', 'p:builder'], remove: ['p:quality'] }]);
    expect(fake.current.labels.filter(({ name }) => name.startsWith('p:')))
      .toEqual([{ name: 'p:builder' }]);
  });

  test('converges on retry without ever removing the receiver', async () => {
    const fake = authorizedHandoffClient();
    fake.current = issue(['s:ready', 'p:builder', 'priority:P1']);
    fake.failNextEdit = 'before';

    await expect(handoff(fake as unknown as GithubClient, 1, handoffFields(), config))
      .rejects.toThrow('partial GitHub mutation');
    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);
    await handoff(fake as unknown as GithubClient, 1, handoffFields(), config);

    expect(fake.comments).toHaveLength(1);
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
    fake.failNextEdit = 'before';
    await expect(acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config))
      .rejects.toThrow('partial GitHub mutation');
    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config);
    await acknowledgeHandoff(fake as unknown as GithubClient, 1, 'builder', 'ready', config);

    expect(fake.comments).toHaveLength(1);
    expect(fake.edits).toEqual([{ add: [], remove: ['handoff'] }]);
  });
});

const blockerBody = (condition = 'dependency missing') => `<!-- cholla:blocker:v1 -->
\`\`\`json
${JSON.stringify({
  profile: 'builder', condition, dependency: '#2', evidence: 'failed', nextCheck: 'after #2',
  eventId: 'blocker-event', blockedAt: '2026-08-29T00:00:00.000Z',
}, null, 2)}
\`\`\``;

const unblockInput = {
  profile: 'builder', sessionId: 'resolver-session',
  resolution: 'Dependency #2 is accepted', evidence: 'https://example.test/2',
};

describe('unblock transition', () => {
  test('records one structured resolution before a disjoint blocked-to-ready projection', async () => {
    const fake = new FakeClient();
    const original = blockerBody();
    fake.current = issue(['s:blocked', 'p:builder', 'priority:P1']);
    fake.current.comments = [{ body: original, createdAt: new Date().toISOString(), author: null }];

    await unblock(fake as unknown as GithubClient, 1, unblockInput, config);

    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]).toContain('cholla:unblock:v1');
    expect(fake.comments[0]).toContain('blocker-resolved');
    expect(fake.comments[0]).toContain('"resolverProfile": "builder"');
    expect(fake.comments[0]).toContain('"actor": "builder"');
    expect(fake.comments[0]).toContain('"targetProfile": "builder"');
    expect(fake.comments[0]).toContain('"blockerDigest"');
    expect(fake.current.comments[0]?.body).toBe(original);
    expect(fake.edits).toEqual([{ add: ['s:ready'], remove: ['s:blocked'] }]);
    expect(fake.edits[0]!.add.filter((label) => fake.edits[0]!.remove.includes(label))).toEqual([]);
    expect(selectNext([fake.current], 'builder', config)).toHaveLength(1);
    const context = await buildContext(
      resolve(import.meta.dir, '..'), 'builder', config, fake as unknown as GithubClient,
    );
    expect(context).toContain('Eligible new work:\n- #1 Work');
    await unblock(fake as unknown as GithubClient, 1, unblockInput, config);
    expect(fake.comments).toHaveLength(1);
    await claim(fake as unknown as GithubClient, 1, 'builder', config, 'claim-session');
    expect(fake.comments.at(-1)).toContain('lease-requested');
  });

  test('uses an explicit sentinel for legacy label-only blocked work', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    await unblock(fake as unknown as GithubClient, 1, unblockInput, config);
    expect(fake.comments[0]).toContain('"legacyBlocked": true');
    expect(fake.comments[0]).not.toContain('"blockerDigest"');
    expect(fake.current.labels.map(({ name }) => name)).toEqual(['p:builder', 's:ready']);
  });

  test('validates nonblank fields, configured resolver, and actor authority before mutation', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    await expect(unblock(fake as unknown as GithubClient, 1, { ...unblockInput, evidence: ' ' }, config))
      .rejects.toThrow('required');
    await expect(unblock(fake as unknown as GithubClient, 1, { ...unblockInput, profile: 'missing' }, config))
      .rejects.toThrow('Unknown profile');
    fake.actor = 'quality';
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('not authorized');
    expect(fake.comments).toEqual([]);
    expect(fake.edits).toEqual([]);
  });

  test.each([
    { name: 'closed', mutate: (fake: FakeClient) => { fake.current.state = 'CLOSED'; } },
    { name: 'assigned', mutate: (fake: FakeClient) => { fake.current.assignees = [{ login: 'worker' }]; } },
    { name: 'live lease', mutate: (fake: FakeClient) => {
      fake.current.comments = [{
        body: '<!-- cholla:claim:v1 -->\n```json\n{"event":"lease-granted","expiresAt":"2999-01-01T00:00:00.000Z"}\n```',
        createdAt: new Date().toISOString(), author: null,
      }];
    } },
    { name: 'ready', mutate: (fake: FakeClient) => { fake.current = issue(['s:ready', 'p:builder']); } },
    { name: 'in progress', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 's:doing', 'p:builder']); } },
    { name: 'decision', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 's:decision', 'p:builder']); } },
    { name: 'handoff', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 'p:builder', 'handoff']); } },
    { name: 'human', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 'p:builder', 'human']); } },
    { name: 'accepted', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 's:accepted', 'p:builder']); } },
    { name: 'multiple profiles', mutate: (fake: FakeClient) => { fake.current = issue(['s:blocked', 'p:builder', 'p:quality']); } },
  ])('fails closed for $name work', async ({ mutate }) => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    mutate(fake);
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config)).rejects.toThrow();
    expect(fake.comments).toEqual([]);
    expect(fake.edits).toEqual([]);
  });

  test('fails closed on a malformed latest structured blocker', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.current.comments = [{
      body: '<!-- cholla:blocker:v1 -->\n```json\n{bad}\n```',
      createdAt: new Date().toISOString(), author: null,
    }];
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('malformed latest structured blocker');
    expect(fake.comments).toEqual([]);
    expect(fake.edits).toEqual([]);
  });

  test('supports an authorized cross-profile resolver while preserving the target profile', async () => {
    const fake = new FakeClient();
    fake.actor = 'quality';
    fake.current = issue(['s:blocked', 'p:builder']);
    await unblock(fake as unknown as GithubClient, 1, {
      ...unblockInput, profile: 'quality',
    }, config);
    expect(fake.comments[0]).toContain('"resolverProfile": "quality"');
    expect(fake.comments[0]).toContain('"targetProfile": "builder"');
    expect(fake.current.labels.map(({ name }) => name)).toContain('p:builder');
  });

  test('supports repository-declared team authority', async () => {
    const fake = new FakeClient();
    fake.actor = 'team-member';
    fake.teamAuthorized = true;
    fake.current = issue(['s:blocked', 'p:builder']);
    const teamConfig = structuredClone(config);
    teamConfig.profiles.builder!.githubActors = { users: [], teams: ['acme/builders'] };
    await unblock(fake as unknown as GithubClient, 1, unblockInput, teamConfig);
    expect(fake.comments[0]).toContain('"actor": "team-member"');
  });

  test('does not project ready when a newer blocker appears after the resolution event', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.current.comments = [{
      body: blockerBody(), createdAt: new Date().toISOString(), author: null,
    }];
    fake.appendBlockerAfterUnblock = true;
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('newer blocker superseded');
    expect(fake.edits).toEqual([]);
    expect(fake.current.labels.map(({ name }) => name)).toContain('s:blocked');
  });

  test('leaves labels unchanged when the resolution comment fails', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.failNextComment = true;
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('comment failed');
    expect(fake.current.labels.map(({ name }) => name)).toEqual(['s:blocked', 'p:builder']);
    expect(fake.edits).toEqual([]);
  });

  test('repairs comment-success and pre-mutation label failure without a duplicate event', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.failNextEdit = 'before';
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('partial GitHub mutation');
    await unblock(fake as unknown as GithubClient, 1, unblockInput, config);
    expect(fake.comments).toHaveLength(1);
    expect(fake.edits).toEqual([{ add: ['s:ready'], remove: ['s:blocked'] }]);
  });

  test('converges after the label mutation applied but its transport failed', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.failNextEdit = 'after';
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('transport failed after mutation');
    await unblock(fake as unknown as GithubClient, 1, unblockInput, config);
    expect(fake.comments).toHaveLength(1);
    expect(fake.current.labels.map(({ name }) => name)).toEqual(['p:builder', 's:ready']);
  });

  test('rejects a repeated invocation when a newer blocker supersedes its bound blocker', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.failNextEdit = 'before';
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config)).rejects.toThrow();
    fake.current.comments!.push({
      body: blockerBody('new blocker'), createdAt: new Date().toISOString(), author: null,
    });
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config))
      .rejects.toThrow('stale or conflicts');
    expect(fake.comments).toHaveLength(1);
    expect(fake.edits).toEqual([]);
  });

  test('rejects conflicting resolution facts for the same blocker', async () => {
    const fake = new FakeClient();
    fake.current = issue(['s:blocked', 'p:builder']);
    fake.failNextEdit = 'before';
    await expect(unblock(fake as unknown as GithubClient, 1, unblockInput, config)).rejects.toThrow();
    await expect(unblock(fake as unknown as GithubClient, 1, {
      ...unblockInput, resolution: 'different attestation',
    }, config)).rejects.toThrow('conflicting resolution facts');
    expect(fake.comments).toHaveLength(1);
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
