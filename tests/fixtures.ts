import type { ChollaConfig, Issue } from '../src/types.ts';

export const config: ChollaConfig = {
  schemaVersion: 1,
  project: { name: 'Test', repository: 'acme/test' },
  knowledge: { layers: [{ id: 'product', purpose: 'Product', paths: ['README.md'], required: true }] },
  profiles: {
    builder: { githubActors: { users: ['builder'], teams: [] }, authority: ['build'], responsibilities: ['code'], exclusions: [], areas: ['core'] },
    quality: { githubActors: { users: ['quality'], teams: [] }, authority: ['accept'], responsibilities: ['verify'], exclusions: [], areas: ['quality'] },
  },
  github: {
    activeMilestoneMarker: '<!-- active -->',
    taxonomy: { types: ['task', 'quality'], priorities: ['P0', 'P1', 'P2'] },
    labels: {
      ready: 's:ready', inProgress: 's:doing', blocked: 's:blocked',
      needsDecision: 's:decision', handoffRequired: 'handoff', humanRequired: 'human',
      accepted: 's:accepted', profilePrefix: 'p:', areaPrefix: 'a:', typePrefix: 't:',
      priorityPrefix: 'priority:',
    },
  },
  policy: { acceptanceProfile: 'quality', requireIndependentAcceptance: true, claimTtlHours: 1 },
};

export function issue(labels: string[] = ['s:ready', 'p:builder', 'priority:P1']): Issue {
  return {
    number: 1, title: 'Work', url: 'https://example.test/1', body: '',
    labels: labels.map((name) => ({ name })), assignees: [],
    milestone: { title: 'M1' }, updatedAt: new Date(0).toISOString(), comments: [],
  };
}
