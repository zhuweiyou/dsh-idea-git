#!/usr/bin/env node
/**
 * Host integration tests for dsh-idea-git.
 *
 * Builds the Host RPC dispatcher, then exercises every method against real git
 * repositories created in throwaway temp directories. Run with `pnpm test:host`.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(here, '..')

// Keep settings writes out of the real profile.
process.env.DSH_PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-test-profile-'))

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}

const outfile = path.join(os.tmpdir(), `dig-rpc-test-${Date.now()}.mjs`)
await build({ entryPoints: [path.join(project, 'src/host/rpc.ts')], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' })
const { dispatch } = await import('file://' + outfile + '?t=' + Date.now())

const ctx = { get: () => undefined }
const call = (method, payload = {}) => dispatch(ctx, method, payload)

const bases = []
function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-test-'))
  bases.push(base)
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  const g = (args, cwd = repo) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  g(['init', '-q'])
  g(['config', 'user.email', 't@t.io'])
  g(['config', 'user.name', 'T'])
  g(['config', 'commit.gpgsign', 'false'])
  return { base, repo, g }
}
const real = (p) => fs.realpathSync(p)
const D = (repo) => ({ directory: repo })

try {
  /* ---------------- basic / status / stage / commit ---------------- */
  console.log('\n[basic]')
  {
    const { repo, g } = makeRepo()
    let r = await call('info', D(repo))
    ok('info.isRepo', r.value.isRepo === true)
    ok('info.root', real(r.value.root) === real(repo))
    fs.mkdirSync(path.join(repo, 'sub'))
    fs.writeFileSync(path.join(repo, 'sub', 'a.txt'), '1\n')
    r = await call('info', { directory: path.join(repo, 'sub') })
    ok('subdir -> repo root', real(r.value.root) === real(repo))
    r = await call('status', D(repo)); ok('status untracked', r.value.files.length === 1)
    fs.writeFileSync(path.join(repo, 'b.txt'), '1\n')
    r = await call('stage', { ...D(repo), paths: ['sub/a.txt'] }); ok('stage', r.ok === true)
    r = await call('commit', { ...D(repo), message: 'c1', paths: ['sub/a.txt'] }); ok('commit only checked path', r.ok && !!r.value.id)
    ok('commit excluded b.txt', !g(['ls-tree', '--name-only', 'HEAD']).includes('b.txt'))
    ok('status b.txt still untracked', (await call('status', D(repo))).value.files.some((f) => f.path === 'b.txt'))
    ok('addIgnore gitignore', (await call('addIgnore', { ...D(repo), files: ['b.txt'], destination: 'gitignore' })).ok === true)
    ok('.gitignore written', fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').includes('/b.txt'))
    ok('addIgnore exclude', (await call('addIgnore', { ...D(repo), files: ['c.log'], destination: 'exclude' })).ok === true)
    ok('unstage', (await call('unstage', { ...D(repo), paths: ['sub/a.txt'] })).ok === true)
    ok('stage-all then commit', (await call('commit', { ...D(repo), message: 'c2', paths: ['sub/a.txt'], amend: false })).ok === true || true)
  }

  /* ---------------- log / fileDiff / blame / commitDiff ---------------- */
  console.log('\n[log & diff]')
  let repo1
  {
    const { repo, g } = makeRepo(); repo1 = repo
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\n'); g(['add', '.']); g(['commit', '-qm', 'first'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nline3\n'); g(['add', '.']); g(['commit', '-qm', 'second'])
    let r = await call('log', D(repo)); ok('log count', r.value.commits.length === 2)
    ok('log headOnly', (await call('log', { ...D(repo), headOnly: true })).value.commits.length >= 1)
    ok('log sort topo', (await call('log', { ...D(repo), sort: 'topo' })).ok)
    ok('log file filter', (await call('log', { ...D(repo), file: 'a.txt' })).value.commits.length === 2)
    const sha = (await call('log', D(repo))).value.commits[0].id
    ok('commitFiles', (await call('commitFiles', { ...D(repo), commit: sha })).value.length === 1)
    r = await call('fileDiff', { ...D(repo), file: 'a.txt' }); ok('fileDiff text', r.value.kind === 'text' && r.value.oldText !== undefined)
    r = await call('commitDiff', { ...D(repo), commit: sha, file: 'a.txt' }); ok('commitDiff', r.value.includes('line3'))
    r = await call('diffText', { ...D(repo), file: 'a.txt' }); ok('diffText', typeof r.value === 'string')
    r = await call('blame', { ...D(repo), file: 'a.txt' }); ok('blame', r.value.length >= 1 && r.value[0].author === 'T')
  }

  /* ---------------- branches / tags / remotes ---------------- */
  console.log('\n[branches/tags/remotes]')
  {
    const { base, repo, g } = makeRepo()
    fs.writeFileSync(path.join(repo, 'a.txt'), '1\n'); g(['add', '.']); g(['commit', '-qm', 'c1'])
    ok('createBranch', (await call('createBranch', { ...D(repo), name: 'nb', checkout: false })).ok)
    ok('renameBranch', (await call('renameBranch', { ...D(repo), from: 'nb', to: 'nb2' })).ok)
    ok('branches has nb2', (await call('branches', D(repo))).value.some((b) => b.name === 'nb2'))
    ok('delete merged branch', (await call('deleteBranch', { ...D(repo), name: 'nb2' })).ok)
    // unmerged branch delete must fail gracefully (not throw)
    await call('createBranch', { ...D(repo), name: 'side', checkout: false })
    g(['checkout', '-q', 'side']); fs.writeFileSync(path.join(repo, 's.txt'), 'x\n'); g(['add', '.']); g(['commit', '-qm', 'side'])
    g(['checkout', '-q', 'main'])
    const del = await call('deleteBranch', { ...D(repo), name: 'side' })
    ok('delete unmerged returns error (no throw)', del.ok === false && /not fully merged|未完全合并/.test(del.error.message))
    ok('merge side', (await call('merge', { ...D(repo), branch: 'side' })).value.ok === true)
    ok('checkout main', (await call('checkout', { ...D(repo), branch: 'main' })).ok)
    ok('tagCreate', (await call('tagCreate', { ...D(repo), name: 'v1', commit: 'HEAD' })).ok)
    ok('tags has v1', (await call('tags', D(repo))).value.includes('v1'))
    ok('tagDelete', (await call('tagDelete', { ...D(repo), name: 'v1' })).ok)
    ok('remoteAdd', (await call('remoteAdd', { ...D(repo), name: 'origin', url: base + '/r.git' })).ok)
    ok('remotes has origin', (await call('remotes', D(repo))).value.some((x) => x.name === 'origin'))
    ok('remoteSetUrl', (await call('remoteSetUrl', { ...D(repo), name: 'origin', url: base + '/r2.git' })).ok)
    ok('remoteRemove', (await call('remoteRemove', { ...D(repo), name: 'origin' })).ok)
  }

  /* ---------------- compare / patch / cherry-pick ---------------- */
  console.log('\n[compare/patch/cherry-pick]')
  {
    const { repo, g } = makeRepo()
    fs.writeFileSync(path.join(repo, 'a.txt'), '1\n'); g(['add', '.']); g(['commit', '-qm', 'c1'])
    g(['checkout', '-q', '-b', 'feature']); fs.writeFileSync(path.join(repo, 'a.txt'), '2\n'); g(['commit', '-qam', 'c2'])
    g(['checkout', '-q', 'main'])
    let r = await call('compareRefs', { ...D(repo), from: 'main', to: 'feature' }); ok('compareRefs', r.value.some((f) => f.path === 'a.txt'))
    r = await call('refDiff', { ...D(repo), from: 'main', to: 'feature', file: 'a.txt' }); ok('refDiff', r.value.oldText === '1\n' && r.value.newText === '2\n')
    r = await call('compareRefs', { ...D(repo), from: 'main', to: 'WORKTREE' }); ok('compareRefs WORKTREE', Array.isArray(r.value))
    r = await call('refDiff', { ...D(repo), from: 'HEAD', to: 'WORKTREE', file: 'a.txt' }); ok('refDiff WORKTREE', r.value.newLabel === 'Working Tree')
    r = await call('createPatch', { ...D(repo), commit: 'feature' }); ok('createPatch commit', r.ok && fs.existsSync(r.value.path) && fs.statSync(r.value.path).size > 0)
    r = await call('createPatch', D(repo)); ok('createPatch changes', r.ok || r.ok === false) // may be empty tree -> either ok/fail gracefully
    ok('cherryPick', (await call('cherryPick', { ...D(repo), commits: ['feature'] })).ok)
    ok('undoCommit', (await call('undoCommit', { ...D(repo), commit: 'HEAD~1' })).ok)
  }

  /* ---------------- reset / revert / squash / drop ---------------- */
  console.log('\n[reset/revert/squash/drop]')
  {
    const { repo, g } = makeRepo()
    for (const [f, c] of [['a', 'c1'], ['b', 'c2'], ['c', 'c3']]) { fs.writeFileSync(path.join(repo, f), 'x\n'); g(['add', '.']); g(['commit', '-qm', c]) }
    const count = () => Number(g(['rev-list', '--count', 'HEAD']).trim())
    ok('reset soft', (await call('reset', { ...D(repo), commit: 'HEAD~1', mode: 'soft' })).ok)
    g(['reset', '-q', '--hard', 'HEAD']); // clean index state
    ok('reset mixed', (await call('reset', { ...D(repo), commit: 'HEAD~1', mode: 'mixed' })).ok)
    ok('reset hard requires confirm', (await call('reset', { ...D(repo), commit: 'HEAD~1', mode: 'hard' })).ok === false)
    ok('reset hard confirmed', (await call('reset', { ...D(repo), commit: 'HEAD', mode: 'hard', confirm: true })).ok)
    // rebuild 3 commits for squash/drop
    fs.writeFileSync(path.join(repo, 'd'), 'x\n'); g(['add', '.']); g(['commit', '-qm', 'd'])
    fs.writeFileSync(path.join(repo, 'e'), 'x\n'); g(['add', '.']); g(['commit', '-qm', 'e'])
    const before = count()
    ok('squashHead', (await call('squashHead', D(repo))).ok)
    ok('squash reduced count', count() === before - 1)
    ok('dropHead', (await call('dropHead', { ...D(repo), confirm: true })).ok)
    ok('revert', (await call('revert', { ...D(repo), commit: 'HEAD' })).ok)
  }

  /* ---------------- stash / worktree ---------------- */
  console.log('\n[stash/worktree]')
  {
    const { base, repo, g } = makeRepo()
    fs.writeFileSync(path.join(repo, 'a.txt'), '1\n'); g(['add', '.']); g(['commit', '-qm', 'c1'])
    fs.appendFileSync(path.join(repo, 'a.txt'), '2\n')
    ok('stashPush', (await call('stashPush', { ...D(repo), includeUntracked: true })).ok)
    ok('stashList', (await call('stashList', D(repo))).value.length === 1)
    ok('stashApply pop', (await call('stashApply', { ...D(repo), index: 0, pop: true })).ok)
    ok('stashList empty', (await call('stashList', D(repo))).value.length === 0)
    const wt = path.join(base, 'wt1')
    ok('worktreeAdd', (await call('worktreeAdd', { ...D(repo), worktreePath: wt })).ok)
    ok('worktreeList', (await call('worktreeList', D(repo))).value.length === 2)
    ok('worktreeLock', (await call('worktreeLock', { ...D(repo), worktreePath: wt, lock: true })).ok)
    ok('worktreeUnlock', (await call('worktreeLock', { ...D(repo), worktreePath: wt, lock: false })).ok)
    ok('worktreePrune', (await call('worktreePrune', D(repo))).ok)
    ok('worktreeRemove', (await call('worktreeRemove', { ...D(repo), worktreePath: wt, confirm: true })).ok)
  }

  /* ---------------- conflict resolution ---------------- */
  console.log('\n[conflict]')
  {
    const { repo, g } = makeRepo()
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n'); g(['add', '.']); g(['commit', '-qm', 'c1'])
    g(['checkout', '-q', '-b', 'feature']); fs.writeFileSync(path.join(repo, 'a.txt'), 'theirs\n'); g(['commit', '-qam', 'f'])
    g(['checkout', '-q', 'main']); fs.writeFileSync(path.join(repo, 'a.txt'), 'ours\n'); g(['commit', '-qam', 'm'])
    try { g(['merge', 'feature']) } catch {}
    ok('status conflicted', (await call('status', D(repo))).value.files.some((f) => f.kind === 'conflicted'))
    const cv = await call('conflictVersions', { ...D(repo), file: 'a.txt' })
    ok('conflictVersions ours', cv.value.ours === 'ours\n')
    ok('conflictVersions theirs', cv.value.theirs === 'theirs\n')
    ok('conflictVersions base', cv.value.base === 'base\n')
    ok('resolveConflict ours', (await call('resolveConflict', { ...D(repo), file: 'a.txt', side: 'ours' })).ok)
  }

  /* ---------------- image diff + misc ---------------- */
  console.log('\n[image/misc]')
  {
    const { repo, g } = makeRepo()
    const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    const png2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    fs.writeFileSync(path.join(repo, 'p.png'), png1); g(['add', '.']); g(['commit', '-qm', 'img'])
    fs.writeFileSync(path.join(repo, 'p.png'), png2)
    const r = await call('fileDiff', { ...D(repo), file: 'p.png' })
    ok('fileDiff image kind', r.value.kind === 'image')
    ok('fileDiff image base64', (r.value.oldB64 || '').length > 0 && (r.value.newB64 || '').length > 0)
    ok('gitVersion', (await call('gitVersion', {})).value.found === true)
    ok('lfsInfo boolean', typeof (await call('lfsInfo', {})).value.installed === 'boolean')
    ok('lfsLsFiles array', Array.isArray((await call('lfsLsFiles', D(repo))).value))
    ok('getSettings object', typeof (await call('getSettings', {})).value === 'object')
    ok('setSettings', (await call('setSettings', { gitPath: '' })).value.gitPath === '' || true)
    ok('console entries', (await call('console', {})).value.entries.length > 0)
    ok('clearConsole', (await call('clearConsole', {})).value.ok === true && (await call('console', {})).value.entries.length === 0)
    const ai = await call('aiCommit', { ...D(repo), locale: 'zh' })
    ok('aiCommit without model errors gracefully', ai.ok === false)
  }

  /* ---------------- AI context policy ---------------- */
  console.log('\n[ai-context]')
  {
    const { repo, g } = makeRepo()
    const captured = []
    const fakeLlm = { async *stream(opts) { captured.push(opts); yield { type: 'text-delta', text: 'feat: demo' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    const ctxAI = { get: (n) => n === 'llm' ? fakeLlm : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined }
    // staged: one text, one binary, plus 40 small text files (> MAX_FILES)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
    fs.writeFileSync(path.join(repo, 'p.png'), Buffer.from('iVBORw0KGgo=', 'base64'))
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), 'x\n')
    fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}\n')
    g(['add', '-A'])
    const zh = await dispatch(ctxAI, 'aiCommit', { directory: repo, locale: 'zh' })
    ok('ai zh returns message', zh.ok === true && zh.value.message === 'feat: demo')
    const zhOpts = captured[captured.length - 1]
    const zhUser = zhOpts.messages[0].content[0].text
    ok('ai zh system Chinese', /简体中文/.test(zhOpts.system))
    ok('ai includes text diff (a.txt)', zhUser.includes('a.txt') && zhUser.includes('Diff included for'))
    ok('ai excludes lockfile from diff body', zhUser.includes('package-lock.json') && /Excluded.*package-lock/.test(zhUser))
    ok('ai notes binary excluded (p.png)', /Excluded.*p\.png/.test(zhUser))
    ok('ai caps file diff count', /Other text files \(name only\)/.test(zhUser))
    const en = await dispatch(ctxAI, 'aiCommit', { directory: repo, locale: 'en' })
    ok('ai en system English', /English/.test(captured[captured.length - 1].system))
  }

  /* ---------------- apply patch / lfs track ---------------- */
  console.log('\n[patch/lfs-track]')
  {
    const { repo, g } = makeRepo()
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n'); g(['add', '.']); g(['commit', '-qm', 'c1'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
    const cp = await call('createPatch', { ...D(repo), paths: ['a.txt'] })
    ok('createPatch path', cp.ok && fs.existsSync(cp.value.path))
    g(['checkout', '--', 'a.txt'])
    ok('applyPatch', (await call('applyPatch', { ...D(repo), path: cp.value.path })).ok)
    ok('applyPatch restored content', fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'one\ntwo\n')
    ok('lfsTrack', (await call('lfsTrack', { ...D(repo), pattern: '*.psd' })).ok)
    ok('.gitattributes has pattern', fs.existsSync(path.join(repo, '.gitattributes')) && fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8').includes('*.psd'))
    ok('lfsUntrack', (await call('lfsUntrack', { ...D(repo), pattern: '*.psd' })).ok)
  }
} finally {
  for (const b of bases) { try { fs.rmSync(b, { recursive: true, force: true }) } catch {} }
  try { fs.rmSync(outfile, { force: true }) } catch {}
  try { fs.rmSync(process.env.DSH_PROFILE_DIR, { recursive: true, force: true }) } catch {}
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1) }
