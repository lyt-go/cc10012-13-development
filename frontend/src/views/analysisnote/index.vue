<template>
  <section class="page" data-module="analysisnote">
    <header class="page-head">
      <div>
        <h2>分析笔记与结论快照</h2>
        <p class="page-desc">
          归并关联数据集、分析发现与视觉截图，发布成可追溯的结论快照；标签写回失败时快照照常保留。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="createOpen = true">登记笔记条目</button>
        <button class="btn" type="button" :disabled="!selectedIds.length" @click="publishSelected">
          归并并发布所选（{{ selectedIds.length }}）
        </button>
        <button class="btn" type="button" @click="exportRows">导出分析笔记清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">冲突证据：{{ conflictCount }}</span>
    </p>

    <p v-if="notice" class="notice" :class="{ 'notice-error': noticeError }">{{ notice }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="panel">
      <div class="panel-head">
        <h3>笔记条目</h3>
        <span class="panel-hint">按条目检查标题、来源数据集、分析发现与参与人</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                :checked="allSelected"
                aria-label="全选笔记"
                @change="toggleAll"
              />
            </th>
            <th>笔记标题</th>
            <th>来源数据集</th>
            <th>分析发现</th>
            <th>参与人</th>
            <th>截图</th>
            <th>可归并检查</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in noteRows"
            :key="row.id"
            :class="{ 'row-active': activeNoteId === row.id }"
            @click="openNote(row.id)"
          >
            <td class="col-check" @click.stop>
              <input
                v-model="selectedIds"
                type="checkbox"
                :value="row.id"
                :aria-label="`选择${row.title}`"
              />
            </td>
            <td>
              <strong>{{ row.title }}</strong>
              <span class="cell-sub">{{ noteNo(row.id) }} · 创建于 {{ noteCreatedAt(row.id) }}</span>
            </td>
            <td>
              <span v-if="row.datasets.length">{{ row.datasets.join('、') }}</span>
              <span v-else class="cell-missing">缺关联数据集</span>
            </td>
            <td>
              {{ row.topics.join('、') || '—' }}
              <span class="cell-sub">{{ row.findings }} 条发现</span>
            </td>
            <td>{{ row.participants.length ? row.participants.join('、') : '—' }}</td>
            <td>{{ row.screenshots }} 张</td>
            <td>
              <span v-if="row.ready" class="badge ok">可归并</span>
              <span v-else class="badge warn">缺 {{ row.missing.join('、') }}</span>
            </td>
            <td>{{ row.status }}<span v-if="row.snapshotId" class="cell-sub">{{ row.snapshotId }}</span></td>
            <td class="row-actions" @click.stop>
              <button class="link" type="button" @click="openNote(row.id)">查看证据</button>
              <button class="link" type="button" @click="publishOne(row.id)">归并发布</button>
              <button class="link" type="button" @click="runFlow(row.id, '提交编写')">提交编写</button>
              <button class="link" type="button" @click="runFlow(row.id, '归档笔记')">归档</button>
            </td>
          </tr>
          <tr v-if="!noteRows.length">
            <td colspan="9" class="empty-state">暂无分析笔记数据，可先登记笔记条目</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="activeNote" class="panel">
      <div class="panel-head">
        <h3>证据链 · {{ activeNote.title }}</h3>
        <span class="panel-hint">归属：{{ activeNote.owner }}（只读） · 创建于 {{ activeNote.createdAt }}</span>
      </div>
      <div class="evidence-grid">
        <div>
          <h4>来源数据集</h4>
          <p class="chip-row">
            <span v-for="dataset in activeNote.datasets" :key="dataset" class="chip">{{ dataset }}</span>
            <span v-if="!activeNote.datasets.length" class="cell-missing">缺关联数据集</span>
          </p>
          <form class="inline-form" @submit.prevent="addDataset">
            <input v-model="datasetDraft" placeholder="补充数据集名称" />
            <button class="btn" type="submit">追加来源</button>
          </form>

          <h4>参与人</h4>
          <p class="chip-row">
            <span v-for="person in activeNote.participants" :key="person" class="chip">{{ person }}</span>
            <span v-if="!activeNote.participants.length" class="cell-missing">缺参与人</span>
          </p>
          <form class="inline-form" @submit.prevent="addPerson">
            <input v-model="participantDraft" placeholder="补充参与人" />
            <button class="btn" type="submit">加入参与人</button>
          </form>
        </div>
        <div>
          <h4>视觉截图（{{ activeNote.screenshots.length }}）</h4>
          <ul class="evidence-list">
            <li v-for="shot in activeNote.screenshots" :key="shot.name">
              <div class="evidence-title">{{ shot.name }}</div>
              <div class="evidence-meta">
                来源：{{ shot.source }} · 数据集：{{ shot.dataSet || '—' }} · 采集：{{ shot.capturedAt }}
              </div>
              <div v-if="shot.uploads.length > 1" class="evidence-meta">
                其他来源：{{ shot.uploads.slice(1).map((item) => item.source).join('、') }}
              </div>
              <div v-if="shot.duplicateUploads" class="evidence-meta">
                同一来源重复上传 {{ shot.duplicateUploads }} 次，仅保留一条引用
              </div>
            </li>
            <li v-if="!activeNote.screenshots.length" class="cell-missing">暂无截图</li>
          </ul>
          <form class="inline-form" @submit.prevent="uploadShot">
            <input v-model="shotDraft.name" placeholder="截图文件名" />
            <input v-model="shotDraft.source" placeholder="来源（图表 / 查询）" />
            <button class="btn" type="submit">上传截图</button>
          </form>
        </div>
      </div>

      <h4>分析发现（{{ activeNote.findings.length }}）</h4>
      <ul class="finding-list">
        <li v-for="finding in activeNote.findings" :key="finding.id">
          <div class="finding-head">
            <strong>{{ finding.topic }}</strong>
            <span class="badge">{{ finding.evidenceKind }}</span>
            <span class="evidence-meta">{{ finding.author }} · {{ finding.createdAt }}</span>
          </div>
          <p class="finding-text">{{ finding.conclusion }}</p>
          <div class="evidence-meta">
            数据集：{{ finding.datasets.join('、') || '—' }}
            <template v-if="finding.screenshotNames.length">
              · 截图：{{ finding.screenshotNames.join('、') }}
            </template>
          </div>
        </li>
      </ul>
      <form class="inline-form wide" @submit.prevent="addFinding">
        <input v-model="findingDraft.topic" placeholder="发现名称（同名归并为一段）" />
        <input v-model="findingDraft.conclusion" placeholder="结论或补充观察" />
        <input v-model="findingDraft.author" placeholder="补充人" />
        <button class="btn" type="submit">追加发现</button>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>分析结论数据快照</h3>
        <div class="panel-tools">
          <label class="toggle">
            <input v-model="failTagWrites" type="checkbox" @change="toggleFailWrites" />
            模拟标签写回失败
          </label>
          <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
        </div>
      </div>
      <p class="panel-hint">
        同一结论重复发布只更新当前版本；标签写回失败时快照完整保留，重试只补齐来源与标签绑定。
      </p>

      <article v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot">
        <header class="snapshot-head">
          <div>
            <h4>{{ snapshot.title }} <span class="version">v{{ snapshot.version }}</span></h4>
            <div class="evidence-meta">
              快照 {{ snapshot.id }} · {{ snapshot.status }} · 归属 {{ snapshot.owner }} · 更新于 {{ snapshot.updatedAt }}
            </div>
          </div>
          <div class="snapshot-actions">
            <span class="badge" :class="writeBackClass(snapshot)">标签：{{ snapshot.tagWriteBack.status }}</span>
            <button class="btn" type="button" @click="retryWriteBack(snapshot.id)">
              {{ snapshot.tagWriteBack.status === '已写回' ? '重新同步标签' : '重试写回' }}
            </button>
          </div>
        </header>
        <p v-if="snapshot.tagWriteBack.error" class="notice notice-error">
          {{ snapshot.tagWriteBack.error }}（快照未受影响，结论与来源均在下方完整保留）
        </p>

        <div class="snapshot-meta">
          <span>数据集：{{ snapshot.datasets.join('、') || '—' }}</span>
          <span>参与人：{{ snapshot.participants.join('、') || '—' }}</span>
          <span>标签：{{ snapshot.tags.join('、') || '—' }}</span>
        </div>
        <div class="snapshot-meta">
          <span>归属：{{ snapshot.owner }}（只读，其他参与人不可改动）</span>
          <span>可见范围：{{ snapshot.acl.join('、') || '—' }}</span>
          <span>发布时间：{{ snapshot.publishedAt }}</span>
        </div>

        <div v-for="section in snapshot.sections" :key="section.key" class="section-card">
          <div class="section-head">
            <strong>{{ section.topic }}</strong>
            <span v-if="section.conflict" class="badge warn">人工与视觉不一致 · {{ reviewLabel(section) }}</span>
            <span v-else-if="section.conclusions.length > 1" class="badge">多版本并存 · 已归并同一段落</span>
            <span v-else class="badge ok">已归并</span>
            <span v-if="section.updatedAt" class="evidence-meta">更新于 {{ section.updatedAt }}</span>
          </div>
          <ul class="conclusion-list">
            <li v-for="conclusion in section.conclusions" :key="conclusion.id">
              <p class="finding-text">{{ conclusion.text }}</p>
              <div class="evidence-meta">
                补充人：{{ conclusion.authors.join('、') }} · 证据：{{ conclusion.evidenceKinds.join('、') }} · 更新于 {{ conclusion.updatedAt }}
              </div>
              <div class="evidence-meta">
                数据集：{{ conclusion.datasets.join('、') || '—' }}
              </div>
            </li>
          </ul>
          <div v-if="section.screenshots.length" class="shot-row">
            <span v-for="shot in section.screenshots" :key="shot.name" class="chip">
              {{ shot.name }} · {{ shot.source }}
            </span>
          </div>
          <div v-if="section.conflict" class="review-bar">
            <span>保留两种证据，复核方向：</span>
            <button class="link" type="button" @click="review(snapshot.id, section.key, '采信人工结论')">
              采信人工结论
            </button>
            <button class="link" type="button" @click="review(snapshot.id, section.key, '采信视觉证据')">
              采信视觉证据
            </button>
            <button class="link" type="button" @click="review(snapshot.id, section.key, '待复核')">待复核</button>
          </div>
        </div>

        <details class="source-block">
          <summary>来源笔记与参与记录（{{ snapshot.sources.length }}）</summary>
          <ul class="evidence-list">
            <li v-for="source in snapshot.sources" :key="source.noteId">
              <div class="evidence-title">{{ source.noteNo }} · {{ source.title }}</div>
              <div class="evidence-meta">
                归属 {{ source.owner }} · 创建 {{ source.createdAt }} · 参与人 {{ source.participants.join('、') }}
              </div>
              <div class="evidence-meta">
                数据集：{{ source.datasets.join('、') }} · 发现：{{ source.findingsSummary }}
              </div>
              <div class="evidence-meta">
                截图：{{ source.screenshots.map((shot) => shot.name).join('、') || '—' }}
              </div>
            </li>
          </ul>
        </details>

        <div class="snapshot-tags">
          <RouterLink
            v-for="binding in tagBindings(snapshot.id)"
            :key="binding.id"
            class="tag-link"
            :to="{ path: '/taggroup', query: { tag: String(binding.id) } }"
          >
            #{{ binding.name }} → 回到结论与数据集
          </RouterLink>
          <span v-if="!tagBindings(snapshot.id).length" class="cell-missing">尚未写回标签</span>
        </div>
      </article>
      <p v-if="!snapshots.length" class="empty-state">还没有结论快照，可勾选笔记条目后归并发布</p>
    </div>

    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记分析笔记</h3>
        <p class="panel-hint">可以先只写结论，数据集、截图和参与人之后再补；归并时会标出缺失来源。</p>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label>笔记标题<input v-model="createDraft.title" placeholder="例如：十月渠道转化复盘" /></label>
          <label>关联数据集<input v-model="createDraft.datasets" placeholder="多个用、分隔" /></label>
          <label>分析发现<textarea v-model="createDraft.finding" rows="3" placeholder="先写结论也可以" /></label>
          <label>参与人<input v-model="createDraft.participants" placeholder="多个用、分隔" /></label>
          <label>标签分类<input v-model="createDraft.tags" placeholder="例如：渠道分析" /></label>
          <div class="modal-actions">
            <button class="btn" type="button" @click="createOpen = false">取消</button>
            <button class="btn primary" type="submit">登记</button>
          </div>
        </form>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ noteRows.length }} 条分析笔记记录 · {{ snapshots.length }} 份结论快照</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  addParticipant,
  appendFinding,
  attachDataset,
  createNote,
  listSnapshots,
  mergeNoteSnapshots,
  noteEvidence,
  noteSummaries,
  publishNote,
  publishNotes,
  registerScreenshot,
  resolveConflict,
  setTagWriteFailure,
  tagBindingsForSnapshot,
  tagWriteFailureEnabled,
  writeBackTags,
} from '@/api/analysis-service'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { resetAnalysisStore } from '@/data/analysis-store'
import { SEED_ROWS } from '@/data/seed'
import type { ConclusionSnapshot, ConflictResolution, SnapshotSection } from '@/data/analysis-types'

const meta = moduleMeta('analysisnote')
const route = useRoute()
const filterFields = ['笔记标题', '关联数据集', '分析发现']
const statuses = ['草稿', '编写中', '已发布', '已归档']

const rows = ref<{ [field: string]: string | number | boolean }[]>([])
const noteRows = ref<ReturnType<typeof noteSummaries>>([])
const snapshots = ref<ConclusionSnapshot[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const noticeError = ref(false)
const filters = ref<Record<string, string>>({})
const activeNoteId = ref<number | null>(null)
const selectedIds = ref<number[]>([])
const datasetDraft = ref('')
const participantDraft = ref('')
const shotDraft = reactive({ name: '', source: '' })
const findingDraft = reactive({ topic: '', conclusion: '', author: '' })
const createOpen = ref(false)
const createDraft = reactive({ title: '', datasets: '', finding: '', participants: '', tags: '' })
const failTagWrites = ref(false)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '笔记条目总数', value: rows.value.length },
  { label: '已发布笔记', value: rows.value.filter((row) => String(row.status) === '已发布').length },
  { label: '编写中笔记', value: rows.value.filter((row) => String(row.status) === '编写中').length },
  { label: '结论快照', value: snapshots.value.length },
])

const activeNote = computed(() => {
  if (activeNoteId.value === null) return null
  const evidence = noteEvidence(activeNoteId.value)
  const row = rows.value.find((item) => Number(item.id) === activeNoteId.value)
  if (!evidence || !row) return null
  return {
    ...evidence,
    title: String(row['笔记标题'] ?? ''),
    noteNo: String(row['笔记编号'] ?? ''),
  }
})

const conflictCount = computed(() => snapshots.value.reduce((sum, item) => sum + item.sections.filter((section) => section.conflict).length, 0))
const allSelected = computed(() => noteRows.value.length > 0 && selectedIds.value.length === noteRows.value.length)

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    noteRows.value = noteSummaries()
    snapshots.value = listSnapshots()
    failTagWrites.value = tagWriteFailureEnabled()
    if (activeNoteId.value !== null && !noteEvidence(activeNoteId.value)) {
      activeNoteId.value = null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '分析笔记列表读取失败'
  }
}

function setNotice(message: string, ok = true) {
  notice.value = message
  noticeError.value = !ok
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function noteNo(noteId: number) {
  const row = rows.value.find((item) => Number(item.id) === noteId)
  return String(row?.['笔记编号'] ?? '')
}

function noteCreatedAt(noteId: number) {
  const row = rows.value.find((item) => Number(item.id) === noteId)
  return String(row?.['创建时间'] ?? '')
}

function openNote(noteId: number) {
  activeNoteId.value = noteId
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? noteRows.value.map((row) => row.id) : []
}

function publishOne(noteId: number) {
  const result = publishNote(noteId)
  setNotice(result.message, result.ok)
  reload()
  if (result.snapshotId) activeNoteId.value = noteId
}

function publishSelected() {
  if (!selectedIds.value.length) return
  const result = publishNotes(selectedIds.value)
  setNotice(result.message, result.ok)
  reload()
  const first = noteRows.value.find((row) => selectedIds.value.includes(row.id) && row.snapshotId)
  if (first) activeNoteId.value = first.id
}

function runFlow(noteId: number, action: string) {
  const result = applyAction(meta.key, noteId, action)
  setNotice(result.message, result.ok)
  reload()
}

function addDataset() {
  if (activeNoteId.value === null) return
  const result = attachDataset(activeNoteId.value, datasetDraft.value)
  setNotice(result.message, result.ok)
  datasetDraft.value = ''
  reload()
}

function addPerson() {
  if (activeNoteId.value === null) return
  const result = addParticipant(activeNoteId.value, participantDraft.value)
  setNotice(result.message, result.ok)
  participantDraft.value = ''
  reload()
}

function uploadShot() {
  if (activeNoteId.value === null) return
  const result = registerScreenshot(activeNoteId.value, {
    name: shotDraft.name,
    source: shotDraft.source,
  })
  setNotice(result.message, result.ok)
  shotDraft.name = ''
  shotDraft.source = ''
  reload()
  republishIfSnapshotted()
}

function addFinding() {
  if (activeNoteId.value === null) return
  const result = appendFinding(activeNoteId.value, {
    topic: findingDraft.topic,
    conclusion: findingDraft.conclusion,
    author: findingDraft.author,
  })
  setNotice(result.message, result.ok)
  findingDraft.topic = ''
  findingDraft.conclusion = ''
  findingDraft.author = ''
  reload()
  republishIfSnapshotted()
}

/** 已发布过的笔记补充来源后同步快照：只补来源，不重算已确认结论。 */
function republishIfSnapshotted() {
  if (activeNoteId.value === null) return
  const row = noteRows.value.find((item) => item.id === activeNoteId.value)
  if (!row?.snapshotId) return
  const result = mergeNoteSnapshots([activeNoteId.value])
  setNotice(`${notice.value}；${result.message}`, true)
  reload()
}

function review(snapshotId: string, sectionKey: string, resolution: ConflictResolution) {
  const result = resolveConflict(snapshotId, sectionKey, resolution)
  setNotice(result.message, result.ok)
  reload()
}

function retryWriteBack(snapshotId: string) {
  setTagWriteFailure(false)
  const result = writeBackTags(snapshotId)
  setNotice(result.message, result.ok)
  failTagWrites.value = false
  reload()
}

function toggleFailWrites() {
  setTagWriteFailure(failTagWrites.value)
  setNotice(
    failTagWrites.value
      ? '已开启模拟失败：下次写回标签会失败，但结论快照仍完整保留'
      : '已关闭模拟失败，可重试写回',
    true,
  )
}

function tagBindings(snapshotId: string) {
  return tagBindingsForSnapshot(snapshotId)
}

function writeBackClass(snapshot: ConclusionSnapshot) {
  if (snapshot.tagWriteBack.status === '已写回') return 'ok'
  if (snapshot.tagWriteBack.status === '写回失败') return 'danger'
  return 'warn'
}

function reviewLabel(section: SnapshotSection) {
  return section.review?.resolution ?? '待复核'
}

function submitCreate() {
  const result = createNote({
    title: createDraft.title,
    datasets: createDraft.datasets.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
    finding: createDraft.finding,
    participants: createDraft.participants.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
    tagNames: createDraft.tags.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
  })
  setNotice(result.message, result.ok)
  if (result.ok) {
    createOpen.value = false
    createDraft.title = ''
    createDraft.datasets = ''
    createDraft.finding = ''
    createDraft.participants = ''
    createDraft.tags = ''
    activeNoteId.value = result.noteId
  }
  reload()
}

function resetAll() {
  resetAnalysisStore()
  const metaKey = 'data-explore-selfservice:entries'
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(metaKey)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        parsed['analysisnote'] = JSON.parse(JSON.stringify(SEED_ROWS['analysisnote']))
        parsed['taggroup'] = JSON.parse(JSON.stringify(SEED_ROWS['taggroup']))
        window.localStorage.setItem(metaKey, JSON.stringify(parsed))
        window.location.reload()
        return
      } catch {
        window.localStorage.removeItem(metaKey)
      }
    }
  }
  window.location.reload()
}

onMounted(() => {
  reload()
  openSnapshotFromQuery()
})

// 首屏就用本地数据渲染，避免列表先空一帧再跳出来。
reload()

function openSnapshotFromQuery() {
  const snapshotId = typeof route.query.snapshot === 'string' ? route.query.snapshot : ''
  if (!snapshotId) return
  const snapshot = snapshots.value.find((item) => item.id === snapshotId)
  if (snapshot?.sources.length) {
    activeNoteId.value = snapshot.sources[0].noteId
  }
}
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.panel-head h3 { margin: 0; font-size: 15px; }
.panel-hint { color: var(--muted); font-size: 12px; margin: 0 0 8px; }
.panel-tools { display: flex; gap: 12px; align-items: center; }
.toggle { font-size: 12px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.notice {
  background: #eef6ff;
  border: 1px solid #b9d8ff;
  color: #1f4f8f;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.notice-error { background: #fef3f2; border-color: #f5c2bd; color: #b42318; }
.cell-sub { display: block; color: var(--muted); font-size: 11px; }
.cell-missing { color: #b42318; font-size: 12px; }
.col-check { width: 32px; text-align: center; }
.row-active { background: #f1f7ff; }
tr { cursor: pointer; }
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  background: #eef2f7;
  color: var(--muted);
}
.badge.ok { background: #e7f6ec; color: #157347; }
.badge.warn { background: #fff4e5; color: #a05a00; }
.badge.danger { background: #fef3f2; color: #b42318; }
.evidence-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 16px; }
.evidence-grid h4, .panel h4 { margin: 10px 0 6px; font-size: 13px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
.chip {
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  color: #334155;
}
.inline-form { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.inline-form.wide { margin-top: 10px; }
.inline-form input { flex: 1 1 140px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.evidence-list { list-style: none; padding: 0; margin: 0 0 8px; }
.evidence-list li { border-bottom: 1px dashed var(--border); padding: 6px 0; }
.evidence-title { font-size: 13px; font-weight: 600; }
.evidence-meta { font-size: 12px; color: var(--muted); }
.finding-list { list-style: none; padding: 0; margin: 0; }
.finding-list li { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
.finding-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.finding-text { margin: 6px 0; font-size: 13px; line-height: 1.6; }
.snapshot { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.snapshot-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.snapshot-head h4 { margin: 0 0 4px; font-size: 14px; }
.version { color: var(--muted); font-weight: 400; font-size: 12px; }
.snapshot-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.snapshot-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--muted); margin: 8px 0; }
.section-card { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: #fbfcfe; }
.section-head { display: flex; gap: 8px; align-items: center; }
.conclusion-list { list-style: none; padding: 0; margin: 6px 0; }
.conclusion-list li { margin-bottom: 8px; }
.shot-row { display: flex; flex-wrap: wrap; gap: 6px; }
.review-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-top: 6px; }
.source-block { margin-top: 8px; font-size: 13px; }
.source-block summary { cursor: pointer; color: var(--brand); font-size: 12px; }
.snapshot-tags { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.tag-link { color: var(--brand); font-size: 12px; text-decoration: none; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal { background: #fff; border-radius: 10px; padding: 18px; width: 460px; max-width: 92vw; }
.modal h3 { margin: 0 0 4px; }
.modal-form { display: flex; flex-direction: column; gap: 10px; }
.modal-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.modal-form input, .modal-form textarea { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
