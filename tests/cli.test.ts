import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const cli = resolve(import.meta.dir, '../src/cli.ts');

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([process.execPath, cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('CLI help', () => {
  test.each(['--help', '-h'])('shows global help with %s', async (flag) => {
    const result = await run(flag);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('cholla v0.1.0');
    expect(result.stdout).toContain('handoff');
    expect(result.stdout).toContain('handoff-ack');
    expect(result.stdout).toContain('unblock');
  });

  test.each([
    { args: ['handoff', '--help'] },
    { args: ['handoff', '--profile', 'runtime-engineer', '--help'] },
    { args: [
      'handoff', '--profile', 'runtime-engineer', '--issue', '26', '--to', 'quality-engineer',
      '--type', 'review-ready', '--context', 'x', '--impact', 'x', '--action', 'x', '--blocking', 'x',
      '--evidence', 'x', '--help',
    ] },
    { args: ['help', 'handoff'] },
  ])('shows handoff help without validating required options: %p', async ({ args }) => {
    const result = await run(...args);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: cholla handoff [options]');
    expect(result.stdout).toContain('Related work (required)');
    expect(result.stdout).toContain('Optional target state');
    expect(result.stdout).not.toContain('Missing --');
  });

  test('reports an unknown help topic', async () => {
    const result = await run('help', 'unknown');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Command 'unknown' not found");
  });

  test('documents the receiver-side handoff transition', async () => {
    const result = await run('handoff-ack', '--help');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: cholla handoff-ack [options]');
    expect(result.stdout).toContain('Persisted workflow state');
  });

  test.each([
    { args: ['unblock', '--help'] },
    { args: ['help', 'unblock'] },
  ])('documents unblock without loading repository configuration: %p', async ({ args }) => {
    const result = await run(...args);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: cholla unblock [options]');
    expect(result.stdout).toContain('Blocker resolution (required)');
    expect(result.stdout).toContain('Supporting evidence (required)');
  });
});
