import type {
  ConclusionSnapshot,
  ConflictResolution,
  EvidenceKind,
  FindingDetail,
  MergeResult,
  NoteEvidence,
  ScreenshotDetail,
  SnapshotSection,
  SnapshotSourceNote,
  WriteBackResult,
} from '@/data/analysis-types'
import {
  loadAnalysisMeta,
  loadNoteEvidence,
  loadSnapshots,
  loadTagBindings,
  normalizeKey,
  saveAnalysisMeta,
  saveNoteEvidence,
  saveSnapshots,
  saveTagBindings,
  splitList,
  stampNow,
  tagBindingKey,
  type TagBinding,
} from '@/data/analysis-store'
import { runAction } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'

// 分析笔记的证据链：把「数据集查询结果 / 截图 / 人工发现」归并成可发布的结论快照。
// 归并是幂等的：同一发现重复提交只更新当前版本，不追加重复段落。

const NOTE_MODULE = 'analysisnote'
const DEFAULT_ACTOR = '值班管理员'

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
}

function laterOf(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function earlierOf(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function canonical(text: string): string {
  return normalizeKey(text)
}

function noteRow(noteId: number): Record<string, string | number | boolean> | null {
  return listRows(NOTE_MODULE).find((row) => Number(row.id) === Number(noteId)) ?? null
}

/** 取笔记的证据明细；通用模块里没有明细时，用笔记字段兜底成一条人工发现。 */
export function ensureEvidence(noteId: number): NoteEvidence | null {
  const row = noteRow(noteId)
  if (!row) return null
  const notes = loadNoteEvidence()
  const existing = notes[Number(noteId)]
  if (existing) return existing
  const createdAt = String(row['创建时间'] ?? '')
  const datasets = splitList(row['关联数据集'])
  const participants = splitList(row['协作人列表'])
  const screenshots: ScreenshotDetail[] = splitList(row['图表截图']).map((name, index) => ({
    id: `SHOT-${noteId}-${index + 1}`,
    name,
    source: `${String(row['笔记编号'] ?? '分析笔记')} / 第 ${index + 1} 张截图`,
    capturedAt: createdAt,
    noteId: Number(noteId),
    noteTitle: String(row['笔记标题'] ?? ''),
    dataSet: datasets[0] ?? '',
    uploads: [
      {
        source: `${String(row['笔记编号'] ?? '分析笔记')} / 第 ${index + 1} 张截图`,
        at: createdAt,
        noteId: Number(noteId),
        noteTitle: String(row['笔记标题'] ?? ''),
        dataSet: datasets[0] ?? '',
      },
    ],
    duplicateUploads: 0,
  }))
  const fallback: NoteEvidence = {
    owner: participants[0] ?? DEFAULT_ACTOR,
    createdAt,
    tagNames: splitList(row['标签分类']),
    datasets,
    participants,
    screenshots,
    findings: [
      {
        id: `FIND-${noteId}-1`,
        topic: String(row['笔记标题'] ?? ''),
        conclusion: String(row['分析发现'] ?? ''),
        author: participants[0] ?? DEFAULT_ACTOR,
        createdAt,
        updatedAt: createdAt,
        evidenceKind: '综合判断',
        datasets,
        screenshotNames: screenshots.map((shot) => shot.name),
      },
    ],
  }
  saveNoteEvidence({ ...notes, [Number(noteId)]: fallback })
  return fallback
}

export function conflictTextKeys(section: SnapshotSection): string[] {
  return unique(section.conclusions.map((item) => canonical(item.text))).sort()
}

/**
 * 把一条发现并入同名段落：
 * - 结论文本相同：只补作者、数据集、截图来源和更新时间，不新增段落；
 * - 结论文本不同：作为并列证据保留，段落标记冲突，等待人工复核，绝不静默覆盖。
 */
function absorbFinding(section: SnapshotSection, finding: FindingDetail, noteId: number): void {
  const text = finding.conclusion.trim()
  if (!text) return
  const evidenceKinds: EvidenceKind[] = [finding.evidenceKind]
  if (finding.screenshotNames.length && !evidenceKinds.includes('视觉证据')) {
    evidenceKinds.push('视觉证据')
  }
  const existing = section.conclusions.find((item) => canonical(item.text) === canonical(text))
  if (existing) {
    existing.authors = unique([...existing.authors, finding.author || DEFAULT_ACTOR])
    existing.noteIds = [...new Set([...existing.noteIds, noteId])]
    existing.evidenceKinds = unique([...existing.evidenceKinds, ...evidenceKinds]) as EvidenceKind[]
    existing.datasets = unique([...existing.datasets, ...finding.datasets])
    existing.screenshotNames = unique([...existing.screenshotNames, ...finding.screenshotNames])
    existing.updatedAt = laterOf(existing.updatedAt, finding.updatedAt || finding.createdAt)
    return
  }
  section.conclusions.push({
    id: `CONC-${noteId}-${section.conclusions.length + 1}`,
    text,
    authors: [finding.author || DEFAULT_ACTOR],
    noteIds: [noteId],
    evidenceKinds,
    datasets: unique(finding.datasets),
    screenshotNames: unique(finding.screenshotNames),
    firstAt: finding.createdAt || stampNow(),
    updatedAt: finding.updatedAt || finding.createdAt || stampNow(),
  })
}

function sectionFor(snapshot: ConclusionSnapshot, topic: string, title: string): SnapshotSection {
  const key = canonical(topic) || canonical(title)
  const existing = snapshot.sections.find((item) => item.key === key)
  if (existing) return existing
  const section: SnapshotSection = {
    key,
    topic: topic.trim() || title,
    conclusions: [],
    conflict: false,
    datasets: [],
    screenshots: [],
    participants: [],
    updatedAt: '',
    review: null,
  }
  snapshot.sections.push(section)
  return section
}

// 人工判断类证据：与视觉/查询结果不一致时才需要复核；同类证据的不同补充不算冲突。
const HUMAN_KINDS: EvidenceKind[] = ['人工结论', '综合判断']

/** 段落汇总：冲突状态、复核是否需要失效、数据集/参与人/截图与更新时间。 */
function refreshSection(section: SnapshotSection, screenshotPool: ScreenshotDetail[]): void {
  const distinct = unique(section.conclusions.map((item) => canonical(item.text)))
  const hasHuman = section.conclusions.some((item) => item.evidenceKinds.some((kind) => HUMAN_KINDS.includes(kind)))
  const hasVisual = section.conclusions.some((item) =>
    item.evidenceKinds.some((kind) => kind === '视觉证据' || kind === '查询结果'),
  )
  const wasConflict = section.conflict
  // 只有「人工结论 vs 视觉/查询证据」说法不一致才标冲突；同类证据的补充观察保留为并列结论。
  section.conflict = distinct.length > 1 && hasHuman && hasVisual
  if (section.conflict && !wasConflict) {
    section.review = null
  }
  if (!section.conflict) {
    section.review = null
  } else if (section.review) {
    const review = section.review
    const keys = conflictTextKeys(section)
    const unchanged =
      keys.length === review.textKeys.length && keys.every((key, index) => key === review.textKeys[index])
    if (!unchanged) {
      // 复核后证据又变了：回到待复核，但两种证据都留着。
      section.review = null
    }
  }
  section.datasets = unique(section.conclusions.flatMap((item) => item.datasets))
  section.participants = unique(section.conclusions.flatMap((item) => item.authors))
  section.updatedAt = section.conclusions.reduce((latest, item) => laterOf(latest, item.updatedAt), section.updatedAt)
  const names = unique(section.conclusions.flatMap((item) => item.screenshotNames)).map(canonical)
  section.screenshots = screenshotPool.filter((shot) => names.includes(canonical(shot.name)))
}

/** 截图按文件名去重：同一来源重复上传只累计次数，不同来源只追加来源记录。 */
function absorbScreenshot(pool: Map<string, ScreenshotDetail>, shot: ScreenshotDetail): void {
  const key = canonical(shot.name)
  const existing = pool.get(key)
  if (!existing) {
    pool.set(key, {
      ...shot,
      uploads: shot.uploads.map((item) => ({ ...item })),
      duplicateUploads: shot.duplicateUploads ?? 0,
    })
    return
  }
  for (const upload of shot.uploads) {
    const seen = existing.uploads.some(
      (item) => canonical(item.source) === canonical(upload.source) && item.noteId === upload.noteId,
    )
    if (!seen) {
      existing.uploads.push({ ...upload, dataSet: upload.dataSet || existing.dataSet })
      existing.capturedAt = earlierOf(existing.capturedAt, upload.at || shot.capturedAt)
    }
  }
  // 次数取两边最大值：重复归并同一条来源不会让计数反复变大。
  existing.duplicateUploads = Math.max(existing.duplicateUploads, shot.duplicateUploads ?? 0)
}

function buildSourceNote(noteId: number, evidence: NoteEvidence, title: string): SnapshotSourceNote {
  const row = noteRow(noteId)
  const now = stampNow()
  return {
    noteId,
    noteNo: String(row?.['笔记编号'] ?? `ANAL-${noteId}`),
    title,
    datasets: unique(evidence.datasets),
    findingsSummary: unique(evidence.findings.map((item) => item.topic)).join('、') || title,
    participants: unique(evidence.participants),
    createdAt: evidence.createdAt,
    owner: evidence.owner,
    screenshots: evidence.screenshots.map((shot) => ({ ...shot })),
    firstMergedAt: now,
    updatedAt: now,
  }
}

function nextSnapshotSeq(): number {
  const meta = loadAnalysisMeta()
  saveAnalysisMeta({ ...meta, nextSnapshotSeq: meta.nextSnapshotSeq + 1 })
  return meta.nextSnapshotSeq
}

function createSnapshot(noteId: number, evidence: NoteEvidence, title: string): ConclusionSnapshot {
  const now = stampNow()
  const seq = nextSnapshotSeq()
  const shotPool = new Map<string, ScreenshotDetail>()
  for (const shot of evidence.screenshots) absorbScreenshot(shotPool, shot)
  const snapshot: ConclusionSnapshot = {
    id: `SNAP-${String(seq).padStart(4, '0')}`,
    title,
    version: 1,
    status: '已发布',
    tags: unique(evidence.tagNames),
    datasets: unique(evidence.datasets),
    participants: unique(evidence.participants),
    sections: [],
    screenshots: [],
    sources: [buildSourceNote(noteId, evidence, title)],
    owner: evidence.owner,
    acl: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    tagWriteBack: { status: '未写回', at: now, error: '', tagIds: [], syncedVersion: 0 },
  }
  for (const finding of evidence.findings) {
    const section = sectionFor(snapshot, finding.topic, title)
    absorbFinding(section, finding, noteId)
  }
  return finalizeSnapshot(snapshot, shotPool)
}

function finalizeSnapshot(snapshot: ConclusionSnapshot, shotPool: Map<string, ScreenshotDetail>): ConclusionSnapshot {
  snapshot.screenshots = [...shotPool.values()]
  for (const section of snapshot.sections) {
    refreshSection(section, snapshot.screenshots)
  }
  snapshot.datasets = unique([...snapshot.datasets, ...snapshot.sections.flatMap((item) => item.datasets)])
  snapshot.participants = unique([
    ...snapshot.participants,
    ...snapshot.sections.flatMap((item) => item.participants),
    ...snapshot.sources.flatMap((item) => item.participants),
  ])
  // 归属记录只读：owner 只认首个来源的作者，后续参与人不会改写归属。
  snapshot.owner = snapshot.sources[0]?.owner ?? snapshot.owner
  snapshot.acl = unique([snapshot.owner, ...snapshot.participants, ...snapshot.tags.map((tag) => `标签:${tag}`)])
  snapshot.sources = snapshot.sources.map((source) => ({
    ...source,
    screenshots: snapshot.screenshots.filter((shot) => shot.uploads.some((item) => item.noteId === source.noteId)),
  }))
  return snapshot
}

function snapshotFingerprint(snapshot: ConclusionSnapshot): string {
  return JSON.stringify({
    title: snapshot.title,
    datasets: [...snapshot.datasets].sort(),
    participants: [...snapshot.participants].sort(),
    tags: [...snapshot.tags].sort(),
    sections: snapshot.sections.map((section) => ({
      key: section.key,
      topic: section.topic,
      conclusions: unique(section.conclusions.map((item) => item.text)).sort(),
      datasets: [...section.datasets].sort(),
      participants: [...section.participants].sort(),
      screenshots: section.screenshots.map((shot) => shot.name).sort(),
    })),
    screenshots: snapshot.screenshots.map((shot) => ({
      name: shot.name,
      sources: shot.uploads.map((item) => item.source).sort(),
    })),
    sources: snapshot.sources.map((source) => source.noteId).sort(),
  })
}

/** 把一条笔记的证据增量并入已有快照：只补缺失来源，已确认的结论文本不重算。 */
function mergeIntoSnapshot(snapshot: ConclusionSnapshot, noteId: number, evidence: NoteEvidence, title: string): boolean {
  const before = snapshotFingerprint(snapshot)
  const shotPool = new Map<string, ScreenshotDetail>()
  for (const shot of snapshot.screenshots) {
    shotPool.set(canonical(shot.name), { ...shot, uploads: shot.uploads.map((item) => ({ ...item })) })
  }
  for (const shot of evidence.screenshots) absorbScreenshot(shotPool, shot)

  for (const finding of evidence.findings) {
    const section = sectionFor(snapshot, finding.topic, title)
    absorbFinding(section, finding, noteId)
  }
  snapshot.datasets = unique([...snapshot.datasets, ...evidence.datasets])
  snapshot.participants = unique([...snapshot.participants, ...evidence.participants])
  snapshot.tags = unique([...snapshot.tags, ...evidence.tagNames])

  const source = snapshot.sources.find((item) => item.noteId === noteId)
  if (source) {
    source.datasets = unique([...source.datasets, ...evidence.datasets])
    source.participants = unique([...source.participants, ...evidence.participants])
    const topics = unique([...source.findingsSummary.split('、'), ...evidence.findings.map((item) => item.topic)])
    source.findingsSummary = topics.join('、')
  } else {
    snapshot.sources.push(buildSourceNote(noteId, evidence, title))
  }

  finalizeSnapshot(snapshot, shotPool)
  const changed = before !== snapshotFingerprint(snapshot)
  if (changed) {
    snapshot.version += 1
    snapshot.updatedAt = stampNow()
    snapshot.publishedAt = snapshot.updatedAt
    if (snapshot.tagWriteBack.status === '已写回' || snapshot.tagWriteBack.status === '待同步') {
      // 结论变了，标签还指向旧版本：保留快照，标记待同步，重试只补绑定。
      snapshot.tagWriteBack = { ...snapshot.tagWriteBack, status: '待同步' }
    }
  }
  return changed
}

export function noteReadiness(noteId: number): {
  ready: boolean
  missing: string[]
  title: string
  datasets: string[]
  participants: string[]
} {
  const row = noteRow(noteId)
  const evidence = ensureEvidence(noteId)
  const title = String(row?.['笔记标题'] ?? '').trim()
  const datasets = unique(evidence?.datasets ?? splitList(row?.['关联数据集']))
  const participants = unique(evidence?.participants ?? splitList(row?.['协作人列表']))
  const missing: string[] = []
  if (!title) missing.push('笔记标题')
  if (!datasets.length) missing.push('关联数据集')
  if (!(evidence?.findings.length ?? 0)) missing.push('分析发现')
  if (!participants.length) missing.push('参与人列表')
  return { ready: missing.length === 0, missing, title, datasets, participants }
}

/**
 * 归并一条或多条笔记并发布成结论快照。
 * 同名快照已存在时走「再发布」：只更新当前版本，不新增并列快照、不追加重复段落。
 */
export function mergeNoteSnapshots(noteIds: number[], actor = DEFAULT_ACTOR): MergeResult {
  const snapshots = loadSnapshots()
  const messages: string[] = []
  const ids: number[] = []
  for (const id of noteIds) {
    const value = Number(id)
    if (Number.isFinite(value) && !ids.includes(value)) ids.push(value)
  }
  let firstSnapshotId = ''
  for (const noteId of ids) {
    const row = noteRow(noteId)
    if (!row) {
      messages.push(`没有找到编号为 ${noteId} 的笔记条目`)
      continue
    }
    const evidence = ensureEvidence(noteId)
    if (!evidence) continue
    const title = String(row['笔记标题'] ?? '').trim()
    if (!title) {
      messages.push(`笔记 ${noteId} 缺少笔记标题，暂不能归并`)
      continue
    }
    const readiness = noteReadiness(noteId)
    const existing = snapshots.find((item) => canonical(item.title) === canonical(title))
    if (!existing) {
      const snapshot = createSnapshot(noteId, evidence, title)
      snapshots.push(snapshot)
      firstSnapshotId = firstSnapshotId || snapshot.id
      messages.push(`已生成结论快照 ${snapshot.id}（v1，${snapshot.sections.length} 条结论、${snapshot.datasets.length} 个数据集）`)
      if (!readiness.ready) {
        messages.push(`来源仍缺 ${readiness.missing.join('、')}，快照可先保留待补`)
      }
      continue
    }
    const versionBefore = existing.version
    const changed = mergeIntoSnapshot(existing, noteId, evidence, title)
    firstSnapshotId = firstSnapshotId || existing.id
    messages.push(
      changed
        ? `《${title}》已更新到 v${existing.version}（原 v${versionBefore}），未追加重复段落`
        : `《${title}》来源无变化，保持 v${existing.version}，未追加重复段落`,
    )
    if (!readiness.ready) {
      messages.push(`来源仍缺 ${readiness.missing.join('、')}，快照可先保留待补`)
    }
  }
  saveSnapshots([...snapshots])
  return {
    ok: firstSnapshotId !== '',
    snapshots: loadSnapshots(),
    message: messages.join('；') || '没有可归并的笔记条目',
    firstSnapshotId,
  }
}

/** 参与人补充观察：追加来源；同一主题同一结论只补作者，不新增段落。 */
export function appendFinding(
  noteId: number,
  input: {
    topic: string
    conclusion: string
    author: string
    evidenceKind?: EvidenceKind
    screenshotNames?: string[]
    datasets?: string[]
  },
): { ok: boolean; message: string } {
  const evidence = ensureEvidence(noteId)
  if (!evidence) return { ok: false, message: `没有找到编号为 ${noteId} 的笔记条目` }
  const topic = input.topic.trim()
  const conclusion = input.conclusion.trim()
  const author = input.author.trim() || DEFAULT_ACTOR
  if (!topic || !conclusion) return { ok: false, message: '补充发现需要同时填写发现名称和结论' }
  const now = stampNow()
  evidence.findings.push({
    id: `FIND-${noteId}-${evidence.findings.length + 1}`,
    topic,
    conclusion,
    author,
    createdAt: now,
    updatedAt: now,
    evidenceKind: input.evidenceKind ?? '人工结论',
    datasets: input.datasets?.length ? unique(input.datasets) : evidence.datasets,
    screenshotNames: unique(input.screenshotNames ?? []),
  })
  evidence.participants = unique([...evidence.participants, author])
  saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
  return { ok: true, message: `已为笔记 ${noteId} 追加「${topic}」的来源记录` }
}

/** 补充关联数据集：只追加缺失来源，已有的不重复登记。 */
export function attachDataset(noteId: number, dataset: string): { ok: boolean; message: string } {
  const evidence = ensureEvidence(noteId)
  if (!evidence) return { ok: false, message: `没有找到编号为 ${noteId} 的笔记条目` }
  const value = dataset.trim()
  if (!value) return { ok: false, message: '数据集名称不能为空' }
  if (evidence.datasets.includes(value)) {
    return { ok: true, message: `数据集「${value}」已在来源中，未重复追加` }
  }
  evidence.datasets = unique([...evidence.datasets, value])
  for (const finding of evidence.findings) {
    finding.datasets = unique([...finding.datasets, value])
  }
  saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
  return { ok: true, message: `已为笔记 ${noteId} 追加数据集「${value}」` }
}

/** 上传截图：同名截图只保留一条引用，同一来源重复上传只累计次数。 */
export function registerScreenshot(
  noteId: number,
  input: { name: string; source: string; capturedAt?: string; dataSet?: string; topic?: string },
): { ok: boolean; message: string } {
  const row = noteRow(noteId)
  const evidence = ensureEvidence(noteId)
  if (!row || !evidence) return { ok: false, message: `没有找到编号为 ${noteId} 的笔记条目` }
  const name = input.name.trim()
  const source = input.source.trim() || '手工上传'
  if (!name) return { ok: false, message: '截图名称不能为空' }
  const at = input.capturedAt?.trim() || stampNow()
  const dataSet = input.dataSet?.trim() || evidence.datasets[0] || ''
  const noteTitle = String(row['笔记标题'] ?? '')
  const existing = evidence.screenshots.find((shot) => canonical(shot.name) === canonical(name))
  if (existing) {
    const seen = existing.uploads.some(
      (item) => canonical(item.source) === canonical(source) && item.noteId === Number(noteId),
    )
    if (seen) {
      existing.duplicateUploads += 1
      saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
      return { ok: true, message: `截图「${name}」已由同一来源上传过，只累计次数、不新增引用` }
    }
    existing.uploads.push({ source, at, noteId: Number(noteId), noteTitle, dataSet })
    saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
    return { ok: true, message: `截图「${name}」已存在，仅补充来源「${source}」` }
  }
  evidence.screenshots.push({
    id: `SHOT-${noteId}-${evidence.screenshots.length + 1}`,
    name,
    source,
    capturedAt: at,
    noteId: Number(noteId),
    noteTitle,
    dataSet,
    uploads: [{ source, at, noteId: Number(noteId), noteTitle, dataSet }],
    duplicateUploads: 0,
  })
  const topicName = input.topic?.trim()
  if (topicName) {
    const finding = evidence.findings.find((item) => canonical(item.topic) === canonical(topicName))
    if (finding) {
      finding.screenshotNames = unique([...finding.screenshotNames, name])
    }
  }
  saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
  return { ok: true, message: `已为笔记 ${noteId} 登记截图「${name}」` }
}

/** 人工结论与视觉结果不一致时，保留两种证据，只记录复核人采信的方向。 */
export function resolveConflict(
  snapshotId: string,
  sectionKey: string,
  resolution: ConflictResolution,
  actor = DEFAULT_ACTOR,
): { ok: boolean; message: string } {
  const snapshots = loadSnapshots()
  const snapshot = snapshots.find((item) => item.id === snapshotId)
  if (!snapshot) return { ok: false, message: `没有找到编号为 ${snapshotId} 的结论快照` }
  const section = snapshot.sections.find((item) => item.key === sectionKey)
  if (!section) return { ok: false, message: '没有找到对应的分析发现' }
  if (!section.conflict) return { ok: false, message: '该发现没有冲突证据，无需复核' }
  section.review = {
    resolution,
    by: actor,
    at: stampNow(),
    textKeys: conflictTextKeys(section),
  }
  snapshot.updatedAt = stampNow()
  saveSnapshots(snapshots.map((item) => (item.id === snapshot.id ? snapshot : item)))
  return { ok: true, message: `已记录复核方向「${resolution}」，两种证据仍保留在快照中` }
}

function syncTagRecords(snapshot: ConclusionSnapshot): number[] {
  const bindings = loadTagBindings()
  const tagRows = [...listRows('taggroup')]
  const meta = loadAnalysisMeta()
  const tagIds: number[] = []
  const usedIds = [...tagRows.map((row) => Number(row.id)), ...Object.values(bindings).map((item) => item.id)]
  let nextId = Math.max(meta.nextTagId, 1, ...usedIds.filter((id) => Number.isFinite(id)).map((id) => id + 1))

  // 先按快照要写的标签建立/复用标签分类中的一行，再把绑定指回这一行。
  for (const tagName of snapshot.tags) {
    let tagRow = tagRows.find((row) => canonical(String(row['标签名称'] ?? '')) === canonical(tagName))
    if (!tagRow) {
      // 标签写回同时落到标签分类模块，保证两个入口看到同一份标签和关联数据集。
      const id = nextId++
      tagRow = {
        id,
        status: '已发布',
        pending: false,
        abnormal: false,
        标签编号: `TAG-${String(id).padStart(4, '0')}`,
        标签名称: tagName,
        标签颜色: '#1f6feb',
        所属分类: '分析结论',
        关联数据集: snapshot.datasets.join('、'),
        使用频次: 1,
        创建时间: stampNow().slice(0, 10),
        最后使用: stampNow(),
      }
      tagRows.push(tagRow)
    } else {
      // 同名标签复用：关联数据集做并集，重复写回不重复计数。
      tagRow['关联数据集'] = unique([...splitList(tagRow['关联数据集']), ...snapshot.datasets]).join('、')
      tagRow['最后使用'] = stampNow()
    }
    const tagId = Number(tagRow.id)
    const key = tagBindingKey(snapshot.id, tagId)
    const previous = bindings[key]
    bindings[key] = {
      id: tagId,
      name: tagName,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      status: '已写回',
      datasets: unique([...snapshot.datasets]),
      noteIds: unique(snapshot.sources.map((source) => String(source.noteId))).map(Number),
      updatedAt: stampNow(),
      lastError: '',
    }
    if (previous && previous.status === '已写回' && previous.snapshotVersion === snapshot.version) {
      // 幂等写回：版本没变时保留首次写回时间，方便检查。
      bindings[key].updatedAt = previous.updatedAt
    }
    tagIds.push(tagId)
  }
  saveTagBindings(bindings)
  saveAnalysisMeta({ ...loadAnalysisMeta(), nextTagId: nextId })
  // 标签分类模块的行与快照标签一一对应。
  saveRows('taggroup', tagRows)
  return tagIds
}

/**
 * 标签写回：失败时快照完整保留、状态标记「写回失败」；重试只补标签绑定，
 * 不重新归并、不重算已确认的结论，也不会追加重复标签。
 */
export function writeBackTags(snapshotId: string): WriteBackResult {
  const snapshot = loadSnapshots().find((item) => item.id === snapshotId) ?? null
  if (!snapshot) return { ok: false, message: `没有找到编号为 ${snapshotId} 的结论快照`, snapshot: null }
  const meta = loadAnalysisMeta()
  if (meta.failTagWrites) {
    snapshot.tagWriteBack = {
      ...snapshot.tagWriteBack,
      status: '写回失败',
      at: stampNow(),
      error: '标签服务暂时不可用（模拟失败）：结论快照与来源均已保留，可稍后重试',
    }
    snapshot.updatedAt = stampNow()
    saveSnapshots(loadSnapshots().map((item) => (item.id === snapshot.id ? snapshot : item)))
    return { ok: false, message: snapshot.tagWriteBack.error, snapshot }
  }
  const tagIds = syncTagRecords(snapshot)
  snapshot.tagWriteBack = {
    status: '已写回',
    at: stampNow(),
    error: '',
    tagIds,
    syncedVersion: snapshot.version,
  }
  snapshot.updatedAt = stampNow()
  saveSnapshots(loadSnapshots().map((item) => (item.id === snapshot.id ? snapshot : item)))
  return { ok: true, message: `标签已写回：${snapshot.tags.join('、') || '（无标签）'}`, snapshot }
}

/**
 * 批量归并并写回标签：每条笔记归并到同名快照，随后统一写回标签。
 * 标签写回失败只影响标签状态，快照与来源不受影响。
 */
export function publishNotes(noteIds: number[], actor = DEFAULT_ACTOR): { ok: boolean; message: string; snapshotIds: string[] } {
  const merge = mergeNoteSnapshots(noteIds, actor)
  if (!merge.ok) return { ok: false, message: merge.message, snapshotIds: [] }
  const titles = new Set(
    noteIds
      .map((id) => noteRow(id)?.['笔记标题'])
      .filter((title): title is string => Boolean(title))
      .map((title) => canonical(String(title))),
  )
  const snapshotIds = merge.snapshots
    .filter((item) => titles.has(canonical(item.title)))
    .map((item) => item.id)
  const messages = [merge.message]
  let ok = true
  // 发布动作顺手把笔记状态推到「已发布」；已经是已发布的不算失败。
  for (const noteId of noteIds) {
    const flow = runAction(NOTE_MODULE, Number(noteId), '发布笔记')
    if (!flow.ok && !flow.message.includes('已经是')) {
      messages.push(flow.message)
      ok = false
    }
  }
  for (const id of snapshotIds) {
    const written = writeBackTags(id)
    messages.push(written.message)
    ok = ok && written.ok
  }
  return { ok, message: messages.join('；'), snapshotIds }
}

/** 发布按钮的完整流程：归并 → 笔记状态流转 → 标签写回（publishNotes 内部完成）。 */
export function publishNote(noteId: number, actor = DEFAULT_ACTOR): { ok: boolean; message: string; snapshotId: string } {
  const merged = publishNotes([noteId], actor)
  if (!merged.snapshotIds.length) {
    return { ok: false, message: merged.message, snapshotId: '' }
  }
  return { ok: merged.ok, message: merged.message, snapshotId: merged.snapshotIds[0] }
}

export function listSnapshots(): ConclusionSnapshot[] {
  return loadSnapshots()
}

export function findSnapshot(snapshotId: string): ConclusionSnapshot | null {
  return loadSnapshots().find((item) => item.id === snapshotId) ?? null
}

export function tagBindingsForSnapshot(snapshotId: string): TagBinding[] {
  return Object.values(loadTagBindings()).filter((item) => item.snapshotId === snapshotId)
}

export function snapshotForTag(tagId: number): ConclusionSnapshot | null {
  const id = Number(tagId)
  const bindings = Object.values(loadTagBindings()).filter((item) => item.id === id)
  if (!bindings.length) return null
  const snapshots = loadSnapshots()
  for (const binding of bindings) {
    const found = snapshots.find((item) => item.id === binding.snapshotId)
    if (found) return found
  }
  return null
}

/** 标签 → 结论快照 → 关联数据集 的完整回溯链，供标签分类页直接展开核对。 */
export function traceTag(tagId: number): {
  tagId: number
  snapshots: {
    id: string
    title: string
    version: number
    status: string
    owner: string
    updatedAt: string
    datasets: string[]
    participants: string[]
    sections: { key: string; topic: string; conclusions: string[]; conflict: boolean; updatedAt: string }[]
    screenshots: { name: string; source: string; uploads: number; duplicateUploads: number }[]
    sources: { noteId: number; noteNo: string; title: string; datasets: string[]; createdAt: string }[]
  }[]
} {
  const id = Number(tagId)
  const bindings = Object.values(loadTagBindings()).filter((item) => item.id === id)
  const snapshots = loadSnapshots()
  return {
    tagId: id,
    snapshots: bindings
      .map((binding) => snapshots.find((item) => item.id === binding.snapshotId))
      .filter((item): item is ConclusionSnapshot => Boolean(item))
      .map((snapshot) => ({
        id: snapshot.id,
        title: snapshot.title,
        version: snapshot.version,
        status: snapshot.status,
        owner: snapshot.owner,
        updatedAt: snapshot.updatedAt,
        datasets: snapshot.datasets,
        participants: snapshot.participants,
        sections: snapshot.sections.map((section) => ({
          key: section.key,
          topic: section.topic,
          conclusions: section.conclusions.map((item) => item.text),
          conflict: section.conflict,
          updatedAt: section.updatedAt,
        })),
        screenshots: snapshot.screenshots.map((shot) => ({
          name: shot.name,
          source: shot.source,
          uploads: shot.uploads.length,
          duplicateUploads: shot.duplicateUploads,
        })),
        sources: snapshot.sources.map((source) => ({
          noteId: source.noteId,
          noteNo: source.noteNo,
          title: source.title,
          datasets: source.datasets,
          createdAt: source.createdAt,
        })),
      })),
  }
}

/**
 * 标签分类入口与结论快照对齐：结论有新增来源但标签还停在旧版本时，补齐绑定与关联数据集。
 * 只补来源和数据集，不重新归并/重算结论；写回明确失败的快照不在这里偷偷改状态。
 */
export function alignTagsWithSnapshots(): void {
  const snapshots = loadSnapshots()
  const bindings = loadTagBindings()
  const stale = Object.values(bindings).filter((binding) => {
    const snapshot = snapshots.find((item) => item.id === binding.snapshotId)
    if (!snapshot) return false
    return snapshot.tagWriteBack.status === '待同步' || binding.snapshotVersion !== snapshot.version
  })
  if (!stale.length) return
  const snapshotIds = [...new Set(stale.map((item) => item.snapshotId))]
  for (const snapshotId of snapshotIds) {
    const snapshot = snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) continue
    // 明确写回失败的快照不在这里静默重试，留给分析笔记页的「重试写回」。
    if (snapshot.tagWriteBack.status === '写回失败') continue
    writeBackTags(snapshot.id)
  }
}

export function noteEvidence(noteId: number): NoteEvidence | null {
  return loadNoteEvidence()[Number(noteId)] ?? null
}

/** 笔记行 + 证据摘要，供列表页按条目检查标题、数据集、发现与参与人。 */
export function noteSummaries(): {
  id: number
  title: string
  status: string
  datasets: string[]
  participants: string[]
  findings: number
  topics: string[]
  screenshots: number
  ready: boolean
  missing: string[]
  snapshotId: string
}[] {
  return listRows(NOTE_MODULE).map((row) => {
    const id = Number(row.id)
    const readiness = noteReadiness(id)
    const evidence = loadNoteEvidence()[id]
    const snapshot = loadSnapshots().find((item) => canonical(item.title) === canonical(readiness.title))
    return {
      id,
      title: readiness.title,
      status: String(row.status ?? ''),
      datasets: readiness.datasets,
      participants: readiness.participants,
      findings: evidence?.findings.length ?? 1,
      topics: unique((evidence?.findings ?? []).map((item) => item.topic)),
      screenshots: evidence?.screenshots.length ?? 0,
      ready: readiness.ready,
      missing: readiness.missing,
      snapshotId: snapshot?.id ?? '',
    }
  })
}

/** 参与人追加观察时，把人也补进参与人列表（只追加，不改归属）。 */
export function addParticipant(noteId: number, name: string): { ok: boolean; message: string } {
  const evidence = ensureEvidence(noteId)
  if (!evidence) return { ok: false, message: `没有找到编号为 ${noteId} 的笔记条目` }
  const value = name.trim()
  if (!value) return { ok: false, message: '参与人姓名不能为空' }
  if (evidence.participants.includes(value)) {
    return { ok: true, message: `「${value}」已在参与人列表中，未重复追加` }
  }
  evidence.participants = unique([...evidence.participants, value])
  saveNoteEvidence({ ...loadNoteEvidence(), [Number(noteId)]: evidence })
  return { ok: true, message: `已把「${value}」加入笔记 ${noteId} 的参与人列表` }
}

/**
 * 登记一条新笔记（标题 / 数据集 / 分析发现 / 截图 / 参与人可分批补）。
 * 先写结论再补数据集和截图也能归并：缺什么就在快照里标什么。
 */
export function createNote(input: {
  title: string
  datasets?: string[]
  finding?: string
  topic?: string
  tagNames?: string[]
  participants?: string[]
  screenshots?: { name: string; source: string }[]
}): { ok: boolean; message: string; noteId: number } {
  const title = input.title.trim()
  if (!title) return { ok: false, message: '笔记标题不能为空', noteId: 0 }
  const rows = [...listRows(NOTE_MODULE)]
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const createdAt = stampNow().slice(0, 10)
  const participants = unique(input.participants ?? [])
  const datasets = unique(input.datasets ?? [])
  const tagNames = unique(input.tagNames ?? [])
  const finding = input.finding?.trim() ?? ''
  const row = {
    id: nextId,
    status: '编写中',
    pending: true,
    abnormal: false,
    笔记编号: `ANAL-${String(nextId).padStart(4, '0')}`,
    笔记标题: title,
    关联数据集: datasets.join('、'),
    分析发现: finding || '（待补充分析发现）',
    图表截图: (input.screenshots ?? []).map((item) => item.name).join('、'),
    标签分类: tagNames.join('、'),
    创建时间: createdAt,
    协作人列表: participants.join('、'),
  }
  const screenshots = (input.screenshots ?? []).map((item, index) => ({
    id: `SHOT-${nextId}-${index + 1}`,
    name: item.name,
    source: item.source,
    capturedAt: stampNow(),
    noteId: nextId,
    noteTitle: title,
    dataSet: datasets[0] ?? '',
    uploads: [
      {
        source: item.source,
        at: stampNow(),
        noteId: nextId,
        noteTitle: title,
        dataSet: datasets[0] ?? '',
      },
    ],
    duplicateUploads: 0,
  }))
  const notes = loadNoteEvidence()
  notes[nextId] = {
    owner: participants[0] ?? DEFAULT_ACTOR,
    createdAt,
    tagNames,
    datasets,
    participants,
    screenshots,
    findings: finding
      ? [
          {
            id: `FIND-${nextId}-1`,
            topic: input.topic?.trim() || title,
            conclusion: finding,
            author: participants[0] ?? DEFAULT_ACTOR,
            createdAt: stampNow(),
            updatedAt: stampNow(),
            evidenceKind: '人工结论',
            datasets,
            screenshotNames: screenshots.map((item) => item.name),
          },
        ]
      : [],
  }
  saveNoteEvidence(notes)
  saveRows(NOTE_MODULE, [...rows, row])
  return { ok: true, message: `已登记笔记「${title}」（ANAL-${String(nextId).padStart(4, '0')}）`, noteId: nextId }
}

export function setTagWriteFailure(flag: boolean): void {
  const meta = loadAnalysisMeta()
  saveAnalysisMeta({ ...meta, failTagWrites: flag })
}

export function tagWriteFailureEnabled(): boolean {
  return loadAnalysisMeta().failTagWrites
}
