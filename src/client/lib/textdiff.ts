/** Line diff + word ranges for the split/unified diff viewer. */
export type IgnorePolicy = 'none' | 'trim' | 'whitespace' | 'whitespaceAndLines'
export type DiffRowKind = 'ctx' | 'rep' | 'del' | 'add'

export interface DiffRow {
  kind: DiffRowKind
  oldNo: number | null
  newNo: number | null
  oldText: string
  newText: string
}

function splitLines(text: string): string[] {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = s.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function norm(line: string, ignore: IgnorePolicy): string {
  switch (ignore) {
    case 'trim': return line.trim()
    case 'whitespace': return line.replace(/\s+/g, '')
    case 'whitespaceAndLines': return line.replace(/\s+/g, '')
    default: return line
  }
}

const MAX_CELLS = 4_000_000

/** LCS-based aligned rows between two texts. */
export function computeRows(oldText: string, newText: string, ignore: IgnorePolicy): DiffRow[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const na = a.map((l) => norm(l, ignore))
  const nb = b.map((l) => norm(l, ignore))
  const n = a.length
  const m = b.length

  // Pairing when the texts are too large for an LCS table.
  if (n * m > MAX_CELLS) {
    const rows: DiffRow[] = []
    const max = Math.max(n, m)
    for (let i = 0; i < max; i++) {
      const hasA = i < n
      const hasB = i < m
      if (hasA && hasB && na[i] === nb[i]) rows.push({ kind: 'ctx', oldNo: i + 1, newNo: i + 1, oldText: a[i], newText: b[i] })
      else if (hasA && hasB) rows.push({ kind: 'rep', oldNo: i + 1, newNo: i + 1, oldText: a[i], newText: b[i] })
      else if (hasA) rows.push({ kind: 'del', oldNo: i + 1, newNo: null, oldText: a[i], newText: '' })
      else rows.push({ kind: 'add', oldNo: null, newNo: i + 1, oldText: '', newText: b[i] })
    }
    return rows
  }

  // DP LCS lengths.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  // Walk producing equal/del/ins ops.
  type Op = { t: 'eq' | 'del' | 'ins'; i?: number; j?: number }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (na[i] === nb[j]) { ops.push({ t: 'eq', i, j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', i }); i++ }
    else { ops.push({ t: 'ins', j }); j++ }
  }
  while (i < n) { ops.push({ t: 'del', i }); i++ }
  while (j < m) { ops.push({ t: 'ins', j }); j++ }

  // Convert to rows, pairing adjacent del/ins runs as replacements.
  const rows: DiffRow[] = []
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op.t === 'eq') {
      rows.push({ kind: 'ctx', oldNo: (op.i as number) + 1, newNo: (op.j as number) + 1, oldText: a[op.i as number], newText: b[op.j as number] })
      k++
      continue
    }
    const dels: number[] = []
    const inss: number[] = []
    while (k < ops.length && ops[k].t === 'del') { dels.push(ops[k].i as number); k++ }
    while (k < ops.length && ops[k].t === 'ins') { inss.push(ops[k].j as number); k++ }
    const pair = Math.min(dels.length, inss.length)
    for (let x = 0; x < pair; x++) {
      const oi = dels[x]
      const nj = inss[x]
      rows.push({ kind: 'rep', oldNo: oi + 1, newNo: nj + 1, oldText: a[oi], newText: b[nj] })
    }
    for (let x = pair; x < dels.length; x++) rows.push({ kind: 'del', oldNo: dels[x] + 1, newNo: null, oldText: a[dels[x]], newText: '' })
    for (let x = pair; x < inss.length; x++) rows.push({ kind: 'add', oldNo: null, newNo: inss[x] + 1, oldText: '', newText: b[inss[x]] })
  }
  return rows
}

export interface WordRanges { aStart: number; aEnd: number; bStart: number; bEnd: number }

/** Changed span of two similar lines (common prefix/suffix trimmed). */
export function wordRanges(a: string, b: string): WordRanges {
  let p = 0
  const min = Math.min(a.length, b.length)
  while (p < min && a[p] === b[p]) p++
  let s = 0
  while (s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return { aStart: p, aEnd: a.length - s, bStart: p, bEnd: b.length - s }
}
