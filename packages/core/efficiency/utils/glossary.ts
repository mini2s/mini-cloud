// 中央术语表（名词解释单一事实源）。给主管看的看板，每个口径词都要能就地解释"是什么/怎么算/什么口径"。
// 复用方式：组件把 glossaryTip(key) 的返回值塞进 MetricCard / MetricScorecard 的 tip（ⓘ 悬浮 title）。
// 新增/改口径只改这里一处，全站一致。已有页面也可逐步接入。

export interface GlossaryEntry {
  /** 名词 */
  term: string
  /** 一句话定义 */
  short: string
  /** 怎么算（可选） */
  formula?: string
  /** 口径/注意（可选） */
  caliber?: string
}

export const GLOSSARY = {
  efficiency_ratio: {
    term: '提效比（日历口径）',
    short: 'AI 让交付变快的倍数，越高越好。',
    formula: '(古法预估工时 − 实际日历工时) ÷ 实际日历工时',
    caliber: '小数口径展示为百分比（0.85→85%）；仅统计可计入且非异常的已合并需求。',
  },
  work_caliber: {
    term: '人力口径提效比',
    short: '按"活跃工作分钟"而非"日历跨度"算的提效比。',
    formula: '(古法预估 − 实际活跃工时) ÷ 实际活跃工时',
    caliber: '与日历口径并存，分别剔除各自异常样本。',
  },
  saved_person_days: {
    term: '省人天',
    short: 'AI 相比古法为团队节省的等效人天。',
    formula: 'max(0, 古法预估日历分钟 − 实际日历分钟) ÷ 480',
    caliber: '1 人天 = 480 分钟；仅可计入且非异常的已合并需求。',
  },
  roi: {
    term: 'ROI（投入产出比）',
    short: '每花 1 元 AI 成本换回的等效人力节省。',
    formula: '折合节省成本 ÷ AI 成本；折合节省成本 = 省人天 × 人天单价',
    caliber: '人天单价见系统配置（缺省 ¥2000/人天）；AI 成本为看板任务口径累计。',
  },
  ai_code_ratio: {
    term: 'AI 代码占比 / 采纳度',
    short: '交付代码中由 AI 生成并被采纳的比例。',
    formula: 'AI 覆盖净增行 ÷ 总净增行',
    caliber: '小数口径展示为百分比；按可计入需求加权。',
  },
  cost: {
    term: 'AI 成本',
    short: '调用大模型产生的费用累计。',
    formula: '按各模型价格表对上行/下行 token 计费求和',
    caliber: '看板任务口径（按 session 归集）；仓库层无成本（commit 不挂 token）。',
  },
  active_users: {
    term: '活跃用户',
    short: '当期真正用 AI 产出交付的人数。',
    formula: '当期有可计入需求的去重用户数',
    caliber: '需求口径参与者；只有 commit、从未采集到 session 的非软件用户不计入。',
  },
  commit_diff_lines: {
    term: '代码贡献（净增行）',
    short: '当期提交的净改动代码行数。',
    formula: 'commit 级净改动行（diff 净增）求和',
  },
  coverage_eligible: {
    term: '可计入需求',
    short: '数据完整、可纳入提效统计的需求。',
    caliber: '需同时有时间与交付两侧数据；缺一侧或撞异常会被隔离，不进提效计算。',
  },
  wow: {
    term: '环比',
    short: '本期相对"等长前一区间"的变化。',
    formula: '(本期 − 上期) ÷ |上期|',
    caliber: '上期 = 与当前日期窗等长、紧邻在前的区间；上期为 0 时不显示箭头。',
  },
  merged_need: {
    term: '需求',
    short: '一个特性分支聚成的一条交付需求，是提效统计的基本单元。',
    caliber: '主干分支(main/master/develop/release)提交不形成需求。',
  },
  silica: {
    term: '含硅量（Silica）',
    short: '代码中可追溯到 AI 生成的比重（实验指标）。',
    caliber: '当前采集填充率极低，本看板暂不作为质量维度展示。',
  },
  dept_efficiency: {
    term: '部门提效',
    short: '按部门聚合的提效比，用于部门间对比。',
    caliber: '基于部门树成员（含子部门）的可计入需求汇总。',
  },
} satisfies Record<string, GlossaryEntry>

export type GlossaryKey = keyof typeof GLOSSARY

/** 拼成 ⓘ 悬浮文本（多行；原生 title 支持 \n 换行）。 */
export function glossaryTip(key: GlossaryKey): string {
  const e: GlossaryEntry = GLOSSARY[key]
  const lines = [`${e.term}：${e.short}`]
  if (e.formula) lines.push(`算法：${e.formula}`)
  if (e.caliber) lines.push(`口径：${e.caliber}`)
  return lines.join('\n')
}
