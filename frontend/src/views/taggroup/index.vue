<template>
  <section class="page" data-module="taggroup">
    <header class="page-head">
      <div>
        <h2>标签分类管理</h2>
        <p class="page-desc">
          标签由分析结论写回，点开任一标签可回到结论快照，再查看关联数据集与截图来源。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记标签定义</button>
        <button class="btn" type="button" @click="exportRows">导出标签分类清单</button>
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
      <span class="legend-item">已关联结论：{{ linkedTagIds.length }}</span>
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>结论回溯</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'row-active': activeTagId === Number(row.id) }"
          @click="openTag(Number(row.id))"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="bindingFor(Number(row.id))" class="badge ok">
              {{ bindingFor(Number(row.id))?.snapshotId }} · v{{ bindingFor(Number(row.id))?.snapshotVersion }}
            </span>
            <span v-else class="cell-muted">未关联分析结论</span>
          </td>
          <td class="row-actions" @click.stop>
            <button class="link" type="button" @click="openTag(Number(row.id))">查看结论</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无标签分类数据，可先登记标签定义</td>
        </tr>
      </tbody>
    </table>

    <div v-if="activeTrace" class="panel">
      <div class="panel-head">
        <h3>标签回溯 · #{{ activeTagName }}</h3>
        <RouterLink class="back-link" to="/analysisnote">去分析笔记查看完整证据链</RouterLink>
      </div>
      <p class="panel-hint">路径：标签 → 分析结论快照 → 关联数据集 → 截图来源 → 来源笔记</p>
      <article v-for="item in activeTrace.snapshots" :key="item.id" class="trace-card">
        <header class="trace-head">
          <div>
            <h4>{{ item.title }} <span class="version">v{{ item.version }}</span></h4>
            <div class="meta">
              快照 {{ item.id }} · 状态 {{ item.status }} · 参与人 {{ item.participants.join('、') || '—' }}
            </div>
          </div>
          <RouterLink class="back-link" :to="{ path: '/analysisnote', query: { snapshot: item.id } }">
            打开分析笔记
          </RouterLink>
        </header>
        <div class="meta">关联数据集：{{ item.datasets.join('、') || '—' }}</div>
        <ul class="trace-list">
          <li v-for="section in item.sections" :key="section.key">
            <strong>{{ section.topic }}</strong>
            <span v-if="section.conflict" class="badge warn">证据不一致（两种均保留）</span>
            <ul>
              <li v-for="(text, index) in section.conclusions" :key="index">{{ text }}</li>
            </ul>
          </li>
        </ul>
        <div class="meta">
          截图来源：
          <span v-for="shot in item.screenshots" :key="shot.name" class="chip">
            {{ shot.name }} · {{ shot.source }}（{{ shot.uploads }} 个来源<template v-if="shot.duplicateUploads">，重复 {{ shot.duplicateUploads }} 次已合并</template>）
          </span>
          <span v-if="!item.screenshots.length">—</span>
        </div>
        <div class="meta">
          来源笔记：
          <span v-for="source in item.sources" :key="source.noteId" class="chip">
            {{ source.noteNo }} · {{ source.title }}（{{ source.datasets.join('、') }} · 创建于 {{ source.createdAt }}）
          </span>
        </div>
        <div class="meta">
          归属：{{ item.owner }}（只读） · 快照更新于 {{ item.updatedAt }}
        </div>
      </article>
      <p v-if="!activeTrace.snapshots.length" class="empty-state">该标签还没有关联的结论快照，可先在分析笔记发布结论</p>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条标签分类记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  alignTagsWithSnapshots,
  traceTag,
} from '@/api/analysis-service'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { loadTagBindings, type TagBinding } from '@/data/analysis-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('taggroup')
const columns = ['标签编号', '标签名称', '标签颜色', '所属分类', '关联数据集', '使用频次', '创建时间', '最后使用']
const actions = ['提交标签评审', '发布标签', '废弃标签']
const statuses = ['草稿', '标签评审中', '已发布', '已废弃']
const filterFields = columns.slice(0, 3)
const route = useRoute()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const noticeError = ref(false)
const filters = ref<Record<string, string>>({})
const activeTagId = ref<number | null>(null)
const bindings = ref<Record<string, TagBinding>>({})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '标签定义总数', value: rows.value.length },
  { label: '已发布标签', value: rows.value.filter((row) => String(row.status) === '已发布').length },
  { label: '评审中标签', value: rows.value.filter((row) => String(row.status) === '标签评审中').length },
  { label: '已关联结论', value: linkedTagIds.value.length },
])

const linkedTagIds = computed(() => [...new Set(Object.values(bindings.value).map((item) => item.id))])
const activeTagName = computed(() => {
  if (activeTagId.value === null) return ''
  const row = rows.value.find((item) => Number(item.id) === activeTagId.value)
  return String(row?.['标签名称'] ?? `标签 ${activeTagId.value}`)
})
const activeTrace = computed(() => (activeTagId.value === null ? null : traceTag(activeTagId.value)))

function bindingFor(tagId: number): TagBinding | undefined {
  return Object.values(bindings.value).find((item) => item.id === tagId)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    bindings.value = loadTagBindings()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '标签分类列表读取失败'
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

function openCreate() {
  setNotice('标签现在由分析结论发布时自动写回，手工登记入口尚未接入审批流', false)
}

function openTag(tagId: number) {
  activeTagId.value = tagId
}

function runAction(action: string, row: EntryRow) {
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  setNotice(result.message, result.ok)
  reload()
}

onMounted(() => {
  // 进入标签入口时先对齐结论快照的来源：只补绑定与数据集，不重算已确认结论。
  alignTagsWithSnapshots()
  reload()
  const queryTag = Number(route.query.tag)
  if (Number.isFinite(queryTag) && queryTag > 0) {
    activeTagId.value = queryTag
  }
  // 从分析笔记点进来的标签可能还没出现在列表里，这里不做额外处理：列表本就全量返回。
})

// 首屏直接渲染标签与回溯面板，测试/截图不用等 mounted。
alignTagsWithSnapshots()
reload()
const initialTag = Number(route.query.tag)
if (Number.isFinite(initialTag) && initialTag > 0) {
  activeTagId.value = initialTag
}
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-top: 14px;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.panel-head h3 { margin: 0; font-size: 15px; }
.panel-hint { color: var(--muted); font-size: 12px; margin: 4px 0 10px; }
.notice {
  background: #eef6ff;
  border: 1px solid #b9d8ff;
  color: #1f4f8f;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.notice-error { background: #fef3f2; border-color: #f5c2bd; color: #b42318; }
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
.cell-muted { color: var(--muted); font-size: 12px; }
.trace-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 10px; }
.trace-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.trace-head h4 { margin: 0 0 4px; font-size: 14px; }
.version { color: var(--muted); font-weight: 400; font-size: 12px; }
.meta { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.7; }
.trace-list { margin: 8px 0; padding-left: 18px; font-size: 13px; }
.trace-list > li { margin-bottom: 6px; }
.trace-list ul { margin: 4px 0 0; padding-left: 16px; color: #334155; }
.chip {
  display: inline-block;
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  color: #334155;
  margin: 2px 4px 2px 0;
}
.back-link { color: var(--brand); text-decoration: none; font-size: 12px; }
</style>
