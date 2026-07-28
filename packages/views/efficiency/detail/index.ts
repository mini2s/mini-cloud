// Barrel for the efficiency detail pages (per-entity drill-downs). Each page
// is router-free: it takes the entity id + an onBack callback and renders
// inside the shared DetailShell. The route pages (apps/web) own navigation.
export { DetailShell } from "./detail-shell";
export { UserDetail } from "./user-detail";
export { UserGroupDetail } from "./user-group-detail";
export { NeedDetail } from "./need-detail";
export { TaskDetail } from "./task-detail";
export { CommitDetail } from "./commit-detail";
export { RepoDetail } from "./repo-detail";
export { WorkDirDetail } from "./workdir-detail";
export { ProjectDetail } from "./project-detail";
