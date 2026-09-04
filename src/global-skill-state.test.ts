import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  listGlobalSkillStates,
  listProjectSkillStates,
  setGlobalSkillEnabled,
  setProjectSkillEnabled,
} from './global-skill-state.ts';

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

describe('project skill state', () => {
  it('disables and restores copies across cwd harness directories', async () => {
    const cwd = join(tmpdir(), `project-skills-${Date.now()}`);
    created.push(cwd);
    const canonical = createSkill(join(cwd, '.agents', 'skills'), 'local-skill');
    const claude = createSkill(join(cwd, '.claude', 'skills'), 'local-skill');

    expect(await setProjectSkillEnabled('local-skill', false, cwd)).toBe(2);
    expect(existsSync(join(canonical, 'SKILL.md.disabled'))).toBe(true);
    expect(existsSync(join(claude, 'SKILL.md.disabled'))).toBe(true);
    expect(existsSync(join(canonical, 'support.txt'))).toBe(true);
    expect(await listProjectSkillStates(cwd)).toMatchObject([
      { name: 'local-skill', enabled: false, hasDisabledCopies: true },
    ]);

    expect(await setProjectSkillEnabled('local-skill', true, cwd)).toBe(2);
    expect(existsSync(join(canonical, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(claude, 'SKILL.md'))).toBe(true);
  });

  it('includes Eve subagent skill copies', async () => {
    const cwd = join(tmpdir(), `project-eve-skills-${Date.now()}`);
    created.push(cwd);
    const skill = createSkill(join(cwd, 'agent', 'subagents', 'research', 'skills'), 'eve-skill');

    expect(await setProjectSkillEnabled('eve-skill', false, cwd)).toBe(1);
    expect(existsSync(join(skill, 'SKILL.md.disabled'))).toBe(true);
    expect(await listProjectSkillStates(cwd)).toMatchObject([
      { name: 'eve-skill', enabled: false },
    ]);
  });

  it('does not follow project skill links outside the cwd', async () => {
    const cwd = join(tmpdir(), `project-contained-${Date.now()}`);
    const outside = join(tmpdir(), `project-outside-${Date.now()}`);
    created.push(cwd, outside);
    const outsideSkill = createSkill(outside, 'escaped');
    const projectSkills = join(cwd, '.agents', 'skills');
    mkdirSync(projectSkills, { recursive: true });
    symlinkSync(outsideSkill, join(projectSkills, 'escaped'), 'dir');

    expect(await listProjectSkillStates(cwd)).toEqual([]);
    expect(await setProjectSkillEnabled('escaped', false, cwd)).toBe(0);
    expect(existsSync(join(outsideSkill, 'SKILL.md'))).toBe(true);
  });
});
