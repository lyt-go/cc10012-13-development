/** 分析笔记 → 分析结论数据快照 的领域类型。纯前端持久化，结构可直接搬回后端。 */

export type EvidenceKind = '人工结论' | '查询结果' | '视觉证据' | '综合判断'

export type FindingDetail = {
  id: string
  topic: string
  conclusion: string
  author: string
  createdAt: string
  updatedAt: string
  evidenceKind: EvidenceKind
  datasets: string[]
  screenshotNames: string[]
}

export type ScreenshotUpload = {
  source: string
  at: string
  noteId: number
  noteTitle: string
  dataSet: string
}

export type ScreenshotDetail = {
  id: string
  /** 截图文件名，也是去重键：同名截图重复上传只保留一条引用。 */
  name: string
  /** 首个上传来源，保证每张截图的来源可追溯。 */
  source: string
  capturedAt: string
  noteId: number
  noteTitle: string
  dataSet: string
  uploads: ScreenshotUpload[]
  duplicateUploads: number
}

export type NoteEvidence = {
  owner: string
  createdAt: string
  tagNames: string[]
  datasets: string[]
  participants: string[]
  screenshots: ScreenshotDetail[]
  findings: FindingDetail[]
}

export type ConflictResolution = '待复核' | '采信人工结论' | '采信视觉证据'

export type ConflictReview = {
  resolution: ConflictResolution
  by: string
  at: string
  /** 复核时看到的结论文本指纹；后续再出现不同结论会自动回到待复核。 */
  textKeys: string[]
}

export type SnapshotConclusion = {
  id: string
  text: string
  authors: string[]
  noteIds: number[]
  evidenceKinds: EvidenceKind[]
  datasets: string[]
  screenshotNames: string[]
  firstAt: string
  updatedAt: string
}

export type SnapshotSection = {
  /** 归一化后的发现名称，作为合并键：同名发现只保留一个段落。 */
  key: string
  topic: string
  conclusions: SnapshotConclusion[]
  conflict: boolean
  datasets: string[]
  screenshots: ScreenshotDetail[]
  participants: string[]
  updatedAt: string
  review: ConflictReview | null
}

export type SnapshotSourceNote = {
  noteId: number
  noteNo: string
  title: string
  datasets: string[]
  findingsSummary: string
  participants: string[]
  createdAt: string
  owner: string
  screenshots: ScreenshotDetail[]
  firstMergedAt: string
  updatedAt: string
}

export type TagWriteBackStatus = '未写回' | '已写回' | '写回失败' | '待同步'

export type TagWriteBackState = {
  status: TagWriteBackStatus
  at: string
  error: string
  tagIds: number[]
  syncedVersion: number
}

export type ConclusionSnapshot = {
  id: string
  title: string
  version: number
  status: '草稿' | '已发布'
  tags: string[]
  datasets: string[]
  participants: string[]
  sections: SnapshotSection[]
  /** 快照级截图池：按文件名去重，重复上传只留一条引用。 */
  screenshots: ScreenshotDetail[]
  sources: SnapshotSourceNote[]
  owner: string
  acl: string[]
  createdAt: string
  updatedAt: string
  publishedAt: string
  tagWriteBack: TagWriteBackState
}

export type MergeResult = {
  ok: boolean
  snapshots: ConclusionSnapshot[]
  message: string
  firstSnapshotId: string
}

export type WriteBackResult = {
  ok: boolean
  message: string
  snapshot: ConclusionSnapshot | null
}
