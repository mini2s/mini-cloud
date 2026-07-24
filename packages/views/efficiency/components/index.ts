// Shared efficiency UI building blocks. KpiCard is reused from runtimes
// (import directly from "../../runtimes/components/shared" at call sites — no
// re-export to avoid extra indirection). Executive cards (HeroSaving,
// TrendCard, etc.) and efficiency-specific components are added in slice 2.
export { MetricScorecard } from "./metric-scorecard";
export { ScorecardStrip } from "./scorecard-strip";
export { CountsCard } from "./counts-card";
export { AIPenetrationCard } from "./ai-penetration-card";
export { HeroSaving } from "./hero-saving";
export { TrendCard } from "./trend-card";
export { DeptPKCard } from "./dept-pk-card";
export { TopRankCard } from "./top-rank-card";
export { PlatformObjectiveCard } from "./platform-objective-card";
export { PeriodSelect } from "./period-select";
export { useGranularity, GranularityToggle } from "./granularity-toggle";
