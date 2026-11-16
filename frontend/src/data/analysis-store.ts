/** 分析笔记证据链与结论快照的本地持久化：独立于通用模块存储，避免通用动作覆盖明细。 */

import { ANALYSIS_NOTE_DETAILS } from './analysis-seed'
import { SEED_ROWS } from './seed'
import type {
  ConclusionSnapshot,
  EvidenceKind,
  FindingDetail,
  NoteEvidence,
  ScreenshotDetail,
  ScreenshotUpload,
} from './analysis-types'

export const NOTE_STORAGE_KEY = 'data-explore-selfservice:analysis-notes'
export const SNAPSHOT_STORAGE_KEY = 'data-explore-selfservice:analysis-snapshots'
export const TAG_STORAGE_KEY = 'data-explore-selfservice:analysis-tag-bindings'
export const META_STORAGE_KEY = 'data-explore-selfservice:analysis-meta'

// 一个标签可以同时挂在多份结论快照上，所以绑定按「快照 id + 标签 id」记录。
export type TagBinding = {
  id: number
  name: string
  snapshotId: string
  snapshotVersion: number
  status: '已写回' | '待同步'
  datasets: string[]
  noteIds: number[]
  updatedAt: string
  lastError: string
}

export function tagBindingKey(snapshotId: string, tagId: number): string {
  return `${snapshotId}::${tagId}`
}

export type AnalysisMeta = {
  failTagWrites: boolean
  nextTagId: number
  nextSnapshotSeq: number
}

const EMPTY_META: AnalysisMeta = { failTagWrites: false, nextTagId: 1, nextSnapshotSeq: 1 }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return clone(fallback)
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 写入失败（隐私模式 / 配额）时保留内存值，页面仍可继续核对。
  }
}

export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  return String(value ?? '')
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[。．.!！?？:：；;，,、]/g, '')
}

function nowStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function seedScreenshot(
  raw: { name: string; source: string; capturedAt: string; dataSet: string },
  noteId: number,
  noteTitle: string,
): ScreenshotDetail {
  const upload: ScreenshotUpload = {
    source: raw.source,
    at: raw.capturedAt,
    noteId,
    noteTitle,
    dataSet: raw.dataSet,
  }
  return {
    id: `SHOT-${noteId}-${normalizeKey(raw.name).slice(0, 12) || 'img'}`,
    name: raw.name,
    source: raw.source,
    capturedAt: raw.capturedAt,
    noteId,
    noteTitle,
    dataSet: raw.dataSet,
    uploads: [upload],
    duplicateUploads: 0,
  }
}

function seedNoteEvidence(note: Record<string, string | number | boolean>): NoteEvidence {
  const noteId = Number(note.id)
  const detail = ANALYSIS_NOTE_DETAILS[noteId]
  const title = String(note['笔记标题'] ?? '')
  const participants = splitList(detail?.participants ?? note['协作人列表'])
  const owner = detail?.owner ?? participants[0] ?? '值班管理员'
  const datasets = detail?.datasets ?? splitList(note['关联数据集'])
  const tags = detail?.tagNames ?? splitList(note['标签分类'])
  const screenshots = detail
    ? detail.screenshots.map((item) => seedScreenshot(item, noteId, title))
    : splitList(note['图表截图']).map((name, index) =>
        seedScreenshot(
          {
            name,
            source: `分析笔记 ${noteId} / 第 ${index + 1} 张截图`,
            capturedAt: String(note['创建时间'] ?? ''),
            dataSet: datasets[0] ?? '',
          },
          noteId,
          title,
        ),
      )
  const findings: FindingDetail[] = detail
    ? detail.findings.map((item, index) => ({
        id: `FIND-${noteId}-${index + 1}`,
        topic: item.topic,
        conclusion: item.conclusion,
        author: item.author,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        evidenceKind: item.evidenceKind as EvidenceKind,
        datasets,
        screenshotNames: item.screenshotNames,
      }))
    : [
        {
          id: `FIND-${noteId}-1`,
          topic: title,
          conclusion: String(note['分析发现'] ?? ''),
          author: owner,
          createdAt: String(note['创建时间'] ?? ''),
          updatedAt: String(note['创建时间'] ?? ''),
          evidenceKind: '综合判断',
          datasets,
          screenshotNames: screenshots.map((shot) => shot.name),
        },
      ]
  return {
    owner,
    createdAt: String(note['创建时间'] ?? ''),
    tagNames: tags,
    datasets,
    participants,
    screenshots,
    findings,
  }
}

function seedNotes(): Record<number, NoteEvidence> {
  const notes: Record<number, NoteEvidence> = {}
  for (const note of SEED_ROWS['analysisnote'] ?? []) {
    notes[Number(note.id)] = seedNoteEvidence(note)
  }
  return notes
}

let noteCache: Record<number, NoteEvidence> | null = null
let snapshotCache: ConclusionSnapshot[] | null = null
let tagCache: Record<string, TagBinding> | null = null
let metaCache: AnalysisMeta | null = null

export function loadNoteEvidence(): Record<number, NoteEvidence> {
  if (noteCache === null) {
    const fallback = seedNotes()
    // localStorage 的键一律是字符串：读回来先把数字键还原，避免证据链按 id 查不到。
    const stored = readJSON<Record<string, NoteEvidence>>(NOTE_STORAGE_KEY, {})
    const normalized: Record<number, NoteEvidence> = {}
    for (const [key, value] of Object.entries(stored)) {
      const id = Number(key)
      if (Number.isFinite(id) && value && typeof value === 'object') {
        normalized[id] = value
      }
    }
    noteCache = { ...fallback, ...normalized }
  }
  return noteCache
}

export function saveNoteEvidence(notes: Record<number, NoteEvidence>): void {
  noteCache = notes
  writeJSON(NOTE_STORAGE_KEY, notes)
}

export function loadSnapshots(): ConclusionSnapshot[] {
  if (snapshotCache === null) {
    snapshotCache = readJSON<ConclusionSnapshot[]>(SNAPSHOT_STORAGE_KEY, [])
  }
  return snapshotCache
}

export function saveSnapshots(snapshots: ConclusionSnapshot[]): void {
  snapshotCache = snapshots
  writeJSON(SNAPSHOT_STORAGE_KEY, snapshots)
}

export function loadTagBindings(): Record<string, TagBinding> {
  if (tagCache === null) {
    tagCache = readJSON<Record<string, TagBinding>>(TAG_STORAGE_KEY, {})
  }
  return tagCache
}

export function saveTagBindings(bindings: Record<string, TagBinding>): void {
  tagCache = bindings
  writeJSON(TAG_STORAGE_KEY, bindings)
}

export function loadAnalysisMeta(): AnalysisMeta {
  if (metaCache === null) {
    const stored = readJSON<AnalysisMeta>(META_STORAGE_KEY, EMPTY_META)
    metaCache = { ...EMPTY_META, ...stored }
  }
  return metaCache
}

export function saveAnalysisMeta(meta: AnalysisMeta): void {
  metaCache = meta
  writeJSON(META_STORAGE_KEY, meta)
}

export function resetAnalysisStore(): void {
  noteCache = null
  snapshotCache = null
  tagCache = null
  metaCache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(NOTE_STORAGE_KEY)
    window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY)
    window.localStorage.removeItem(TAG_STORAGE_KEY)
    window.localStorage.removeItem(META_STORAGE_KEY)
  }
}

export function stampNow(): string {
  return nowStamp()
}
