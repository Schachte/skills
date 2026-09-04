import { access, readdir, realpath, rename } from 'fs/promises';
import { isAbsolute, join, relative, sep } from 'path';
import { agents, getEveSubagents } from './agents.ts';
import { getCanonicalSkillsDir, getEveSubagentSkillsDir, sanitizeName } from './installer.ts';
import { parseSkillMd } from './skills.ts';

const ACTIVE_FILE = 'SKILL.md';
const DISABLED_FILE = 'SKILL.md.disabled';

export interface GlobalSkillState {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  hasDisabledCopies: boolean;
}

export type ProjectSkillState = GlobalSkillState;

function globalSkillRoots(): string[] {
  return Array.from(
    new Set([
      getCanonicalSkillsDir(true),
      ...Object.values(agents)
        .map((agent) => agent.globalSkillsDir)
        .filter((path): path is string => Boolean(path)),
    ])
  );
}

function projectSkillRoots(cwd: string): string[] {
  return Array.from(
    new Set([
      getCanonicalSkillsDir(false, cwd),
      ...Object.values(agents).map((agent) => join(cwd, agent.skillsDir)),
      ...getEveSubagents(cwd).map((subagent) => getEveSubagentSkillsDir(subagent, cwd)),
    ])
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isWithin(parent: string, path: string): boolean {
  const child = relative(parent, path);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function scanGlobalSkillFiles(
  roots: string[],
  containmentRoot?: string
): Promise<
  Array<{
    name: string;
    description: string;
    path: string;
    activePath: string;
    disabledPath: string;
    enabled: boolean;
    disabled: boolean;
  }>
> {
  const results = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      if (containmentRoot) {
        let resolvedPath: string;
        try {
          resolvedPath = await realpath(path);
        } catch {
          continue;
        }
        if (!isWithin(containmentRoot, resolvedPath)) continue;
      }
      const activePath = join(path, ACTIVE_FILE);
      const disabledPath = join(path, DISABLED_FILE);
      const enabled = await pathExists(activePath);
      const disabled = await pathExists(disabledPath);
      const skillPath = enabled ? activePath : disabledPath;
      if (!enabled && !disabled) continue;
      const skill = await parseSkillMd(skillPath);
      if (!skill) continue;
      results.push({
        name: skill.name,
        description: skill.description,
        path,
        activePath,
        disabledPath,
        enabled,
        disabled,
      });
    }
  }
  return results;
}

export async function listGlobalSkillStates(
  roots: string[] = globalSkillRoots(),
  containmentRoot?: string
): Promise<GlobalSkillState[]> {
  const states = new Map<string, GlobalSkillState>();
  for (const skill of await scanGlobalSkillFiles(roots, containmentRoot)) {
    const key = sanitizeName(skill.name);
    const existing = states.get(key);
    if (existing) {
      existing.enabled ||= skill.enabled;
      existing.hasDisabledCopies ||= skill.disabled;
      continue;
    }
    states.set(key, {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      enabled: skill.enabled,
      hasDisabledCopies: skill.disabled,
    });
  }
  return Array.from(states.values());
}

export async function listProjectSkillStates(cwd = process.cwd()): Promise<ProjectSkillState[]> {
  return listGlobalSkillStates(projectSkillRoots(cwd), await realpath(cwd));
}

export async function setGlobalSkillEnabled(
  name: string,
  enabled: boolean,
  roots: string[] = globalSkillRoots(),
  containmentRoot?: string
): Promise<number> {
  const targetName = sanitizeName(name);
  let changed = 0;
  const skills = (await scanGlobalSkillFiles(roots, containmentRoot)).filter(
    (skill) => sanitizeName(skill.name) === targetName
  );
  for (const skill of skills) {
    if (skill.enabled && skill.disabled) {
      throw new Error(`Cannot toggle ${name}: both ${ACTIVE_FILE} and ${DISABLED_FILE} exist`);
    }
  }
  for (const skill of skills) {
    if (skill.enabled === enabled) continue;
    const source = enabled ? skill.disabledPath : skill.activePath;
    const destination = enabled ? skill.activePath : skill.disabledPath;
    if (!(await pathExists(source))) continue;
    await rename(source, destination);
    changed += 1;
  }
  return changed;
}

export async function setProjectSkillEnabled(
  name: string,
  enabled: boolean,
  cwd = process.cwd()
): Promise<number> {
  return setGlobalSkillEnabled(name, enabled, projectSkillRoots(cwd), await realpath(cwd));
}
