/** 分析笔记的示例明细：补充「查询结果 / 截图 / 人工发现 / 参与人」的可追溯信息。 */

export type SeedNoteDetail = {
  id: number
  owner: string
  datasets: string[]
  participants: string[]
  tagNames: string[]
  screenshots: { name: string; source: string; capturedAt: string; dataSet: string }[]
  findings: {
    topic: string
    conclusion: string
    author: string
    createdAt: string
    evidenceKind: '人工结论' | '查询结果' | '视觉证据' | '综合判断'
    screenshotNames: string[]
  }[]
}

// 只登记需要完整证据链的笔记；其余条目按通用字段兜底成一条人工发现。
export const ANALYSIS_NOTE_DETAILS: Record<number, SeedNoteDetail> = {
  1: {
    id: 1,
    owner: '林晓',
    datasets: ['渠道汇总数据集 DWS_CHANNEL_DAY', '订单明细数据集 ADS_ORDER_DETAIL'],
    participants: ['林晓', '周航'],
    tagNames: ['渠道分析'],
    screenshots: [
      {
        name: '八月渠道转化-0901.png',
        source: '图表构建 / 图表 CHAR-0003',
        capturedAt: '2026-09-01 09:40',
        dataSet: '渠道汇总数据集 DWS_CHANNEL_DAY',
      },
      {
        name: '八月分渠道明细-0901.png',
        source: '查询结果 / 订单明细数据集 ADS_ORDER_DETAIL',
        capturedAt: '2026-09-01 09:52',
        dataSet: '订单明细数据集 ADS_ORDER_DETAIL',
      },
    ],
    findings: [
      {
        topic: '八月渠道转化',
        conclusion: '八月渠道转化率整体稳定，自然流量贡献约六成。',
        author: '林晓',
        createdAt: '2026-09-01 10:05',
        evidenceKind: '人工结论',
        screenshotNames: [],
      },
      {
        topic: '八月渠道转化',
        conclusion: '八月渠道转化率环比小幅下滑 0.8 个百分点，自然流量贡献约五成。',
        author: '周航',
        createdAt: '2026-09-01 16:20',
        evidenceKind: '视觉证据',
        screenshotNames: ['八月渠道转化-0901.png', '八月分渠道明细-0901.png'],
      },
    ],
  },
  2: {
    id: 2,
    owner: '林晓',
    datasets: ['订单明细数据集 ADS_ORDER_DETAIL', '渠道汇总数据集 DWS_CHANNEL_DAY'],
    participants: ['林晓', '周航'],
    tagNames: ['渠道分析'],
    screenshots: [
      {
        name: '渠道日趋势-0928.png',
        source: '图表构建 / 图表 CHAR-0003',
        capturedAt: '2026-09-28 10:12',
        dataSet: '渠道汇总数据集 DWS_CHANNEL_DAY',
      },
      {
        name: '付费渠道对比-0928.png',
        source: '透视分析 / 配置 PIVO-0003',
        capturedAt: '2026-09-28 14:48',
        dataSet: '订单明细数据集 ADS_ORDER_DETAIL',
      },
    ],
    findings: [
      {
        topic: '九月渠道转化',
        conclusion: '九月渠道转化率环比提升 3.2 个百分点，主要由自然流量贡献；付费渠道未出现同步增长。',
        author: '林晓',
        createdAt: '2026-09-28 10:30',
        evidenceKind: '人工结论',
        screenshotNames: [],
      },
      {
        // 周航用截图复核，结论一致：同一发现只保留一个段落，视觉证据挂到该段落下。
        topic: '九月渠道转化',
        conclusion: '九月渠道转化率环比提升 3.2 个百分点，主要由自然流量贡献；付费渠道未出现同步增长。',
        author: '周航',
        createdAt: '2026-09-28 15:05',
        evidenceKind: '视觉证据',
        screenshotNames: ['渠道日趋势-0928.png', '付费渠道对比-0928.png'],
      },
    ],
  },
  3: {
    id: 3,
    owner: '周航',
    datasets: ['订单明细数据集 ADS_ORDER_DETAIL'],
    participants: ['周航', '林晓'],
    tagNames: ['复购分析'],
    screenshots: [
      {
        name: '付费复购-0903.png',
        source: '图表构建 / 图表 CHAR-0002',
        capturedAt: '2026-09-03 11:30',
        dataSet: '订单明细数据集 ADS_ORDER_DETAIL',
      },
    ],
    findings: [
      {
        topic: '付费渠道复购',
        conclusion: '付费渠道复购率连续两月持平，仍需补充同比数据。',
        author: '周航',
        createdAt: '2026-09-03 11:45',
        evidenceKind: '人工结论',
        screenshotNames: ['付费复购-0903.png'],
      },
    ],
  },
}
