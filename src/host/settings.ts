/** Durable plugin settings (currently the git executable path). */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface IdeaGitSettings { gitPath?: string }

let cache: IdeaGitSettings | null = null

function filePath(): string {
  const base = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh')
  return path.join(base, 'idea-git.settings.json')
}

export function getSettings(): IdeaGitSettings {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as IdeaGitSettings
  } catch {
    cache = {}
  }
  return cache
}

export function saveSettings(patch: IdeaGitSettings): IdeaGitSettings {
  cache = { ...getSettings(), ...patch }
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2))
  } catch {}
  return cache
}
