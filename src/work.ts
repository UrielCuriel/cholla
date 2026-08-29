import { relative, resolve } from 'node:path';
import type { ChollaConfig, Issue } from './types.ts';
import { GithubClient, labelNames, readyForProfile } from './github.ts';

const CLAIM_MARKER = '<!-- cholla:claim:v1 -->';
const HANDOFF_MARKER = '<!-- cholla:handoff:v1 -->';
const HANDOFF_ACK_MARKER = '<!-- cholla:handoff-ack:v1 -->';
const ACCEPTANCE_MARKER = '<!-- cholla:acceptance:v1 -->';
const BLOCKER_MARKER = '<!-- cholla:blocker:v1 -->';

export function selectNext(issues: Issue[], profile: string, config: ChollaConfig): Issue[] {
  const priorities = config.github.taxonomy.priorities.map(
    (priority) => `${config.github.labels.priorityPrefix}${priority}`,
  );
  return issues.filter((issue) => readyForProfile(issue, profile, config)).sort((a, b) => {
    const aLabels = labelNames(a);
    const bLabels = labelNames(b);
    const aPriority = priorities.findIndex((label) => aLabels.includes(label));
    const bPriority = priorities.findIndex((label) => bLabels.includes(label));
    const rank = (value: number) => value === -1 ? priorities.length : value;
    return rank(aPriority) - rank(bPriority) || a.number - b.number;
  });
}

export async function buildContext(
  repoRoot: string,
  profileId: string,
  config: ChollaConfig,
  client: GithubClient,
): Promise<string> {
  const profile = config.profiles[profileId];
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  const milestone = await client.activeMilestone(config.github.activeMilestoneMarker);
  const milestoneIssues = await client.issues(milestone.title);
  const issues = selectNext(await client.issues(), profileId, config);
  const profileLabel = `${config.github.labels.profilePrefix}${profileId}`;
  const active = milestoneIssues.filter((issue) => {
    const labels = labelNames(issue);
    return labels.includes(profileLabel) && labels.includes(config.github.labels.inProgress);
  });
  const handoffs = milestoneIssues.filter((issue) => {
    const labels = labelNames(issue);
    return labels.includes(profileLabel) && labels.includes(config.github.labels.handoffRequired);
  });
  const layerIds = new Set(profile.knowledge ?? []);
  const layers = config.knowledge.layers.filter((layer) =>
    layer.required || layer.profiles?.includes(profileId) || layerIds.has(layer.id),
  );
  if (profile.instructions?.length) {
    layers.push({
      id: `profile:${profileId}`,
      purpose: 'Profile-specific operating instructions',
      paths: profile.instructions,
      required: true,
    });
  }
  const missing: string[] = [];
  for (const layer of layers) {
    for (const path of layer.paths) {
      const absolute = resolve(repoRoot, path);
      if (relative(repoRoot, absolute).startsWith('..')) {
        throw new Error(`Knowledge path escapes repository: ${path}`);
      }
      if (!(await Bun.file(absolute).exists())) missing.push(path);
    }
  }
  const lines = [
    `Project: ${config.project.name}`,
    `Profile: ${profileId}`,
    `Authority: ${profile.authority.join('; ')}`,
    `Active milestone: ${milestone.title}`,
    '', 'Read in order:',
    ...layers.flatMap((layer) => [
      `- ${layer.id}: ${layer.purpose}`,
      ...layer.paths.map((path) => `  - ${path}`),
    ]),
    '', 'Active profile responsibilities:',
    ...(active.length ? active.map((issue) => `- #${issue.number} ${issue.title} — ${issue.url}`) : ['- None']),
    '', 'Pending handoffs:',
    ...(handoffs.length ? handoffs.map((issue) => `- #${issue.number} ${issue.title} — ${issue.url}`) : ['- None']),
    '', 'Eligible new work:',
    ...(issues.length ? issues.map((issue) => `- #${issue.number} ${issue.title} — ${issue.url}`) : ['- None']),
  ];
  if (missing.length) lines.push('', `Missing required sources: ${missing.join(', ')}`);
  return lines.join('\n');
}

function structuredComment(marker: string, fields: Record<string, unknown>): string {
  const json = JSON.stringify(fields, null, 2);
  return `${marker}\n\`\`\`json\n${json}\n\`\`\``;
}

function structuredFields(comment: string, marker: string): Record<string, unknown> | undefined {
  if (!comment.startsWith(marker)) return undefined;
  const fenced = comment.match(/```json\s*([\s\S]*?)\s*```/);
  if (!fenced?.[1]) return undefined;
  try {
    const value = JSON.parse(fenced[1]);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function claim(
  client: GithubClient,
  number: number,
  profile: string,
  config: ChollaConfig,
  sessionId: string,
): Promise<void> {
  const before = await client.issue(number);
  if (!readyForProfile(before, profile, config)) throw new Error('Issue is not ready and unassigned for this profile');
  await client.comment(number, structuredComment(CLAIM_MARKER, {
    event: 'lease-requested',
    eventId: crypto.randomUUID(),
    profile,
    sessionId,
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.policy.claimTtlHours * 3_600_000).toISOString(),
  }));
  // A serialized coordinator grants or denies the lease. A client-side
  // read/comment/edit sequence cannot provide mutual exclusion.
}

export async function handoff(
  client: GithubClient,
  number: number,
  fields: Record<string, string>,
  config: ChollaConfig,
  targetState?: HandoffTargetState,
): Promise<void> {
  const required = ['from', 'to', 'type', 'context', 'impact', 'requiredAction', 'blockingCondition', 'evidence', 'relatedWork'];
  const absent = required.filter((key) => !fields[key]?.trim());
  if (absent.length) throw new Error(`Missing handoff fields: ${absent.join(', ')}`);
  const sender = config.profiles[fields.from!];
  if (!sender) throw new Error(`Unknown profile: ${fields.from}`);
  if (!config.profiles[fields.to!]) throw new Error(`Unknown profile: ${fields.to}`);
  const actor = await client.currentActor();
  const authorizedByUser = sender.githubActors.users.includes(actor);
  const authorizedByTeam = !authorizedByUser && await Promise.all(
    sender.githubActors.teams.map((team) => client.isTeamMember(team, actor)),
  ).then((memberships) => memberships.some(Boolean));
  if (!authorizedByUser && !authorizedByTeam) {
    throw new Error(`GitHub actor ${actor} is not authorized for profile ${fields.from}`);
  }

  const issue = await client.issue(number);
  const labels = labelNames(issue);
  const stateLabels: Record<HandoffTargetState, string> = {
    ready: config.github.labels.ready,
    blocked: config.github.labels.blocked,
    'needs-decision': config.github.labels.needsDecision,
  };
  const stateEntries = Object.entries(stateLabels) as [HandoffTargetState, string][];
  const currentStates = stateEntries.filter(([, label]) => labels.includes(label)).map(([state]) => state);
  if (currentStates.length !== 1) {
    throw new Error(`Issue #${number} must have exactly one workflow state before handoff`);
  }
  const currentState = currentStates[0]!;
  if (targetState && targetState !== currentState
    && !(currentState === 'needs-decision' && targetState === 'ready')) {
    throw new Error(`Unsupported handoff state transition: ${currentState} -> ${targetState}`);
  }

  const eventFields = targetState ? { ...fields, targetState } : fields;
  const latestHandoff = [...(issue.comments ?? [])].reverse().find(
    (comment) => comment.body.startsWith(HANDOFF_MARKER),
  );
  const matchingHandoff = latestHandoff && (() => {
    const persisted = structuredFields(latestHandoff.body, HANDOFF_MARKER);
    return persisted && Object.entries(eventFields).every(([key, value]) => persisted[key] === value)
      ? latestHandoff
      : undefined;
  })();
  let matchingPendingHandoff = false;
  if (matchingHandoff) {
    const digest = await sha256(matchingHandoff.body);
    matchingPendingHandoff = !(issue.comments ?? []).some((comment) => {
      const acknowledgment = structuredFields(comment.body, HANDOFF_ACK_MARKER);
      return acknowledgment?.handoffDigest === digest;
    });
  }
  if (!matchingPendingHandoff) {
    await client.comment(number, structuredComment(HANDOFF_MARKER, {
      ...eventFields,
      event: 'handoff-recorded',
      eventId: crypto.randomUUID(),
      handedOffAt: new Date().toISOString(),
    }));
  }

  const receiverProfileLabel = `${config.github.labels.profilePrefix}${fields.to}`;
  const remove = labels.filter(
    (label) => label.startsWith(config.github.labels.profilePrefix) && label !== receiverProfileLabel,
  );
  if (targetState && targetState !== currentState) remove.push(stateLabels[currentState]);
  const add = [config.github.labels.handoffRequired, receiverProfileLabel];
  if (targetState) add.push(stateLabels[targetState]);
  await client.editLabels(
    number,
    [...new Set(add)],
    [...new Set(remove)].filter((label) => !add.includes(label)),
  );
}

export type HandoffTargetState = 'ready' | 'blocked' | 'needs-decision';

/**
 * Acknowledge the latest structured handoff as its persisted receiver.
 *
 * The target state must already be present. This transition only records
 * receiver consumption and removes handoff:required, so it cannot turn a
 * blocked or decision-pending issue into executable work accidentally.
 * Comment-first ordering makes a retry repair a partial label mutation.
 */
export async function acknowledgeHandoff(
  client: GithubClient,
  number: number,
  profile: string,
  targetState: HandoffTargetState,
  config: ChollaConfig,
): Promise<void> {
  if (!config.profiles[profile]) throw new Error(`Unknown profile: ${profile}`);
  const issue = await client.issue(number);
  const labels = labelNames(issue);
  const stateLabels: Record<HandoffTargetState, string> = {
    ready: config.github.labels.ready,
    blocked: config.github.labels.blocked,
    'needs-decision': config.github.labels.needsDecision,
  };
  const expectedState = stateLabels[targetState];
  if (!labels.includes(expectedState)) {
    throw new Error(`Handoff target state ${targetState} is not present on issue #${number}`);
  }

  const handoffComment = [...(issue.comments ?? [])]
    .reverse()
    .find((comment) => comment.body.startsWith(HANDOFF_MARKER));
  if (!handoffComment) throw new Error(`Issue #${number} has no structured handoff`);
  const handoff = structuredFields(handoffComment.body, HANDOFF_MARKER);
  if (!handoff || typeof handoff.to !== 'string') {
    throw new Error(`Issue #${number} has an invalid structured handoff`);
  }
  if (handoff.to !== profile) {
    throw new Error(`Handoff receiver is ${handoff.to}, not ${profile}`);
  }

  const handoffDigest = await sha256(handoffComment.body);
  const acknowledgments = (issue.comments ?? [])
    .map((comment) => structuredFields(comment.body, HANDOFF_ACK_MARKER))
    .filter((fields): fields is Record<string, unknown> => fields !== undefined);
  const alreadyAcknowledged = acknowledgments.some(
    (fields) => fields.handoffDigest === handoffDigest && fields.profile === profile,
  );

  if (!labels.includes(config.github.labels.handoffRequired) && !alreadyAcknowledged) {
    throw new Error(`Issue #${number} has no pending handoff to acknowledge`);
  }

  if (!alreadyAcknowledged) {
    await client.comment(number, structuredComment(HANDOFF_ACK_MARKER, {
      event: 'handoff-acknowledged',
      eventId: crypto.randomUUID(),
      handoffDigest,
      profile,
      targetState,
      acknowledgedAt: new Date().toISOString(),
    }));
  }

  if (labels.includes(config.github.labels.handoffRequired)) {
    await client.editLabels(number, [], [config.github.labels.handoffRequired]);
  }
}

export async function accept(
  client: GithubClient,
  number: number,
  profile: string,
  evidence: string,
  config: ChollaConfig,
  sessionId: string,
): Promise<void> {
  if (config.policy.requireIndependentAcceptance) {
    if (!config.policy.acceptanceProfile || profile !== config.policy.acceptanceProfile) {
      throw new Error(`Acceptance requires profile ${config.policy.acceptanceProfile ?? '(not configured)'}`);
    }
    const issue = await client.issue(number);
    const claims = (issue.comments ?? []).filter((comment) => comment.body.startsWith(CLAIM_MARKER));
    if (claims.some((claim) => claim.body.includes(`"profile": "${profile}"`))) {
      throw new Error('Independent acceptance cannot be performed by the implementing profile');
    }
    if (claims.some((claim) => claim.body.includes(`"sessionId": "${sessionId}"`))) {
      throw new Error('Independent acceptance requires a different Codex session from implementation');
    }
    if (config.policy.requireDistinctActor) {
      const actor = await client.currentActor();
      if (claims.some((claim) => claim.author?.login === actor)) {
        throw new Error('Independent acceptance cannot be performed by the implementing actor');
      }
    }
  }
  await client.comment(number, structuredComment(ACCEPTANCE_MARKER, {
    profile, sessionId, evidence, acceptedAt: new Date().toISOString(),
  }));
  await client.editLabels(number, [config.github.labels.accepted], [config.github.labels.inProgress]);
}

export async function block(
  client: GithubClient,
  number: number,
  fields: { profile: string; condition: string; dependency: string; evidence: string; nextCheck: string },
  config: ChollaConfig,
): Promise<void> {
  if (Object.values(fields).some((field) => !field.trim())) throw new Error('All blocker fields are required');
  await client.comment(number, structuredComment(BLOCKER_MARKER, {
    ...fields,
    eventId: crypto.randomUUID(),
    blockedAt: new Date().toISOString(),
  }));
  await client.editLabels(
    number,
    [config.github.labels.blocked],
    [config.github.labels.ready, config.github.labels.inProgress],
  );
}
