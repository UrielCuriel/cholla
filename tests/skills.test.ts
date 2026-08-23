import { expect, test } from 'bun:test';

test('all shipped skills have valid minimal frontmatter and no scaffold placeholders', async () => {
  const glob = new Bun.Glob('blueprint/.agents/skills/*/SKILL.md');
  const paths = [...glob.scanSync('.')];
  expect(paths).toHaveLength(5);
  for (const path of paths) {
    const text = await Bun.file(path).text();
    expect(text.startsWith('---\nname: ')).toBeTrue();
    expect(text).toContain('\ndescription: ');
    expect(text).not.toContain('[TODO');
  }
});
