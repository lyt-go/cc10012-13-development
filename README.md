# 数据查询探索与自助分析平台

面向数据查询编辑器、可视化探索、自助分析看板、数据导出分发、分析笔记协作与查询历史管理的本地化数据分析应用平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 查询编辑器 | `queryeditor` | 查询脚本 | 脚本编号、脚本名称、查询语句 |
| 数据源管理 | `datasources` | 数据源连接 | 连接编号、连接名称、连接类型 |
| 查询历史 | `queryhistory` | 历史记录 | 记录编号、查询语句摘要、执行时间 |
| 图表构建 | `chartbuilder` | 图表配置 | 配置编号、图表名称、图表类型 |
| 自助看板 | `dashboardboard` | 看板布局 | 布局编号、看板名称、包含图表组 |
| 数据导出 | `exporttask` | 导出任务 | 任务编号、数据来源、导出格式 |
| 分析笔记 | `analysisnote` | 笔记条目 | 笔记编号、笔记标题、关联数据集 |
| 参数化查询 | `paramquery` | 参数模板 | 模板编号、模板名称、查询骨架 |
| 定时任务 | `schedulerjob` | 定时作业 | 作业编号、关联查询、调度cron |
| 数据字典 | `dataschema` | 表结构 | 结构编号、表名、字段名 |
| 查询优化 | `queryopt` | 优化建议 | 建议编号、原始查询、优化后查询 |
| 透视分析 | `pivotable` | 透视配置 | 配置编号、数据来源、行维度字段 |
| 数据对比 | `datacompare` | 对比方案 | 方案编号、数据集A、数据集B |
| 访问控制 | `permission` | 访问规则 | 规则编号、数据源、授权人 |
| 标签分类 | `taggroup` | 标签定义 | 标签编号、标签名称、标签颜色 |
| 结果评估 | `resulteval` | 评估记录 | 记录编号、关联查询、结果准确性 |
| 分享管理 | `sharelink` | 分享链接 | 链接编号、分享内容、链接URL |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `data-explore-selfservice:entries` 这一项，或调用 `resetModule(模块)`。

领域：数据工程
子方向：数据分析与数据应用

## 分析笔记 → 分析结论数据快照

`analysisnote` 不再只是列表页：页面把笔记条目的**关联数据集 / 分析发现 / 视觉截图 / 参与人**
归并成一份可发布的结论快照，并可从 `taggroup` 的标签反查回来。

- 归并键：笔记标题（快照）+ 发现名称（段落）+ 结论文本（结论）。同名只更新当前版本，
  重复发布不新增快照、不追加重复段落。
- 证据：每条结论保留补充人、证据类型（人工结论 / 查询结果 / 视觉证据 / 综合判断）、
  数据集、截图名和更新时间；截图按文件名去重，同一来源重复上传只累计次数。
- 冲突：人工结论与视觉/查询结果不一致时，两种文本都保留在段落里，标「待复核」，
  可记录采信方向，但不会删除任一证据。
- 标签：写回标签分类模块（同名标签复用，关联数据集取并集）。写回失败时快照完整保留并
  标记「写回失败」，重试只补标签绑定，不重算结论；同名标签/快照不会重复生成。
- 归属：快照 owner 只认首个来源笔记，参与人只能追加观察与来源，不能改写归属。

主要代码：`frontend/src/api/analysis-service.ts`（归并/发布/写回）、
`frontend/src/data/analysis-store.ts`（证据链与快照的 localStorage 持久化）、
`frontend/src/data/analysis-types.ts`。分析笔记页勾选条目即可归并发布，页面内可模拟
标签写回失败并重试；标签分类页点标签可回溯到结论、数据集、截图来源和来源笔记。
