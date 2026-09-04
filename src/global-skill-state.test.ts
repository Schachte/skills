import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listGlobalSkillStates, setGlobalSkillEnabled } from './global-skill-state.ts';

const created: string[] = [];

function createSkill(root: string, name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test ${name}\n---\n\n# ${name}\n`
  );
  writeFileSync(join(path, 'support.txt'), 'preserve me');
  return path;
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('global skill state', () => {
  it('disables and restores every installed copy without deleting its files', async () => {
    const rootA = join(tmpdir(), `global-skills-a-${Date.now()}`);
    const rootB = join(tmpdir(), `global-skills-b-${Date.now()}`);
    created.push(rootA, rootB);
    const skillA = createSkill(rootA, 'external-skill');
    const skillB = createSkill(rootB, 'external-skill');

    expect(await setGlobalSkillEnabled('external-skill', false, [rootA, rootB])).toBe(2);
    expect(existsSync(join(skillA, 'SKILL.md.disabled'))).toBe(true);
    expect(existsSync(join(skillB, 'SKILL.md.disabled'))).toBe(true);
    expect(existsSync(join(skillA, 'support.txt'))).toBe(true);
    expect(existsSync(join(skillB, 'support.txt'))).toBe(true);
    expect(await listGlobalSkillStates([rootA, rootB])).toMatchObject([
      { name: 'external-skill', enabled: false },
    ]);

    expect(await setGlobalSkillEnabled('external-skill', true, [rootA, rootB])).toBe(2);
    expect(existsSync(join(skillA, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillB, 'SKILL.md'))).toBe(true);
  });

  it('does not touch a different skill', async () => {
    const root = join(tmpdir(), `global-skills-${Date.now()}`);
    created.push(root);
    const untouched = createSkill(root, 'untouched');
    createSkill(root, 'selected');

    await setGlobalSkillEnabled('selected', false, [root]);
    expect(existsSync(join(untouched, 'SKILL.md'))).toBe(true);
  });

  it('converges mixed copies to the selected state', async () => {
    const rootA = join(tmpdir(), `global-skills-mixed-a-${Date.now()}`);
    const rootB = join(tmpdir(), `global-skills-mixed-b-${Date.now()}`);
    created.push(rootA, rootB);
    const skillA = createSkill(rootA, 'mixed');
    const skillB = createSkill(rootB, 'mixed');
    renameSync(join(skillB, 'SKILL.md'), join(skillB, 'SKILL.md.disabled'));

    expect(await listGlobalSkillStates([rootA, rootB])).toMatchObject([
      { name: 'mixed', enabled: true, hasDisabledCopies: true },
    ]);
    expect(await setGlobalSkillEnabled('mixed', true, [rootA, rootB])).toBe(1);
    expect(existsSync(join(skillA, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillB, 'SKILL.md'))).toBe(true);

    expect(await setGlobalSkillEnabled('mixed', false, [rootA, rootB])).toBe(2);
    expect(existsSync(join(skillA, 'SKILL.md.disabled'))).toBe(true);
    expect(existsSync(join(skillB, 'SKILL.md.disabled'))).toBe(true);
  });

  it('does not make partial changes when a copy has conflicting state files', async () => {
    const rootA = join(tmpdir(), `global-skills-conflict-a-${Date.now()}`);
    const rootB = join(tmpdir(), `global-skills-conflict-b-${Date.now()}`);
    created.push(rootA, rootB);
    const skillA = createSkill(rootA, 'conflict');
    const skillB = createSkill(rootB, 'conflict');
    writeFileSync(
      join(skillB, 'SKILL.md.disabled'),
      '---\nname: conflict\ndescription: Conflict\n---\n'
    );

    await expect(setGlobalSkillEnabled('conflict', false, [rootA, rootB])).rejects.toThrow(
      'both SKILL.md and SKILL.md.disabled exist'
    );
    expect(existsSync(join(skillA, 'SKILL.md'))).toBe(true);
  });
});
