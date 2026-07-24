// Barrel for the efficiency dashboard UI. Consumed by the web app via
// `import { OverviewPage } from "@multica/views/efficiency"`.
export { OverviewPage } from "./overview-page";
export {
  AIPenetrationCard,
  CountsCard,
  DeptPKCard,
  HeroSaving,
  MetricScorecard,
  PlatformObjectiveCard,
  ScorecardStrip,
  TopRankCard,
  TrendCard,
} from "./components";
export {
  TrendChart,
  RankingBarChart,
  PieBreakdownChart,
  MultiTrendChart,
  VerticalBarChart,
  ComboTrendChart,
} from "./charts";
export {
  UsageKanban,
  DeptTreePanel,
  DeptAggregateView,
  DeptCompareView,
  MembersView,
  MemberDetailDialog,
} from "./usage";
export { CostKanban, CostAggregateView, CostCompareView, CostMembersView } from "./cost";
export {
  EfficiencyDimension,
  EfficiencyTimeline,
  EfficiencyUserRanking,
  EfficiencyRepoRanking,
  DistributionOverview,
} from "./efficiency";
export {
  ContributionDimension,
  OrgContribution,
  UserContribution,
  ProjectContribution,
  RepoContribution,
} from "./contribution";
export {
  PricingPage,
  DatasourcesPage,
  SyncTasksPage,
  SystemConfigPage,
} from "./settings";
export {
  DetailShell,
  UserDetail,
  NeedDetail,
  TaskDetail,
  CommitDetail,
  RepoDetail,
  ProjectDetail,
} from "./detail";
