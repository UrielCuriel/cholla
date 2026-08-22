import type { ChollaConfig, Issue, Milestone } from './types.ts';

export interface CommandRunner {
  run(args: string[]): Promise<string>;
}

export class BunCommandRunner implements CommandRunner {
  async run(args: string[]): Promise<string> {
    const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `${args[0]} exited ${exitCode}`);
    return stdout;
  }
}

export class GithubClient {
  constructor(
    private readonly repository: string,
    private readonly runner: CommandRunner = new BunCommandRunner(),
  ) {}

  private gh(args: string[]): Promise<string> {
    return this.runner.run(['gh', ...args, '--repo', this.repository]);
  }

  async authStatus(): Promise<void> {
    await this.runner.run(['gh', 'auth', 'status']);
  }

  async currentActor(): Promise<string> {
    const output = await this.runner.run(['gh', 'api', 'user', '--jq', '.login']);
    return output.trim();
  }

  async milestones(): Promise<Milestone[]> {
    const output = await this.runner.run([
      'gh', 'api', `repos/${this.repository}/milestones?state=open&per_page=100`,
    ]);
    return JSON.parse(output) as Milestone[];
  }

  async activeMilestone(marker: string): Promise<Milestone> {
    const open = await this.milestones();
    const marked = open.filter((item) => item.description?.includes(marker));
    if (marked.length === 1) return marked[0]!;
    throw new Error(
      `Expected exactly one active milestone (${marker}); found ${marked.length} marked among ${open.length} open`,
    );
  }

  async issues(milestone: string): Promise<Issue[]> {
    const output = await this.gh([
      'issue', 'list', '--state', 'open', '--milestone', milestone, '--limit', '200',
      '--json', 'number,title,url,body,labels,assignees,milestone,updatedAt',
    ]);
    return JSON.parse(output) as Issue[];
  }

  async issue(number: number): Promise<Issue> {
    const output = await this.gh([
      'issue', 'view', String(number),
      '--json', 'number,title,url,body,labels,assignees,milestone,updatedAt,comments',
    ]);
    return JSON.parse(output) as Issue;
  }

  async comment(number: number, body: string): Promise<void> {
    await this.gh(['issue', 'comment', String(number), '--body', body]);
  }

  async editLabels(number: number, add: string[], remove: string[] = []): Promise<void> {
    const args = ['issue', 'edit', String(number)];
    for (const label of add) args.push('--add-label', label);
    for (const label of remove) args.push('--remove-label', label);
    await this.gh(args);
  }

  async assignSelf(number: number): Promise<void> {
    await this.gh(['issue', 'edit', String(number), '--add-assignee', '@me']);
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    await this.gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
  }
}

export async function bootstrapLabels(client: GithubClient, config: ChollaConfig): Promise<string[]> {
  const definitions = new Map<string, [string, string]>([
    [config.github.labels.ready, ['0E8A16', 'Eligible for a profile to lease']],
    [config.github.labels.inProgress, ['1D76DB', 'Has an active Cholla lease']],
    [config.github.labels.blocked, ['B60205', 'Cannot progress until a named condition changes']],
    [config.github.labels.needsDecision, ['D93F0B', 'Requires a persisted decision']],
    [config.github.labels.handoffRequired, ['FBCA04', 'Another profile must act']],
    [config.github.labels.humanRequired, ['B60205', 'Requires an explicitly justified human decision']],
    [config.github.labels.accepted, ['5319E7', 'Acceptance evidence independently verified']],
  ]);
  for (const profile of Object.keys(config.profiles)) {
    definitions.set(`${config.github.labels.profilePrefix}${profile}`, ['C5DEF5', `Authority profile: ${profile}`]);
  }
  const areas = new Set(Object.values(config.profiles).flatMap((profile) => profile.areas));
  for (const area of areas) {
    definitions.set(`${config.github.labels.areaPrefix}${area}`, ['BFDADC', `Architectural area: ${area}`]);
  }
  for (const type of config.github.taxonomy.types) {
    definitions.set(`${config.github.labels.typePrefix}${type}`, ['D4C5F9', `Work type: ${type}`]);
  }
  for (const priority of config.github.taxonomy.priorities) {
    definitions.set(`${config.github.labels.priorityPrefix}${priority}`, ['F9D0C4', `Priority: ${priority}`]);
  }
  for (const [name, [color, description]] of definitions) {
    await client.ensureLabel(name, color, description);
  }
  return [...definitions.keys()];
}

export function labelNames(issue: Issue): string[] {
  return issue.labels.map(({ name }) => name);
}

export function readyForProfile(issue: Issue, profile: string, config: ChollaConfig): boolean {
  const labels = labelNames(issue);
  const excluded = [
    config.github.labels.inProgress,
    config.github.labels.blocked,
    config.github.labels.needsDecision,
    config.github.labels.handoffRequired,
    config.github.labels.humanRequired,
    config.github.labels.accepted,
  ];
  return labels.includes(config.github.labels.ready)
    && labels.includes(`${config.github.labels.profilePrefix}${profile}`)
    && !excluded.some((label) => labels.includes(label))
    && issue.assignees.length === 0;
}
