-- 158_backfill_platform_admin_workflow_perm.down.sql
-- No-op: the backfill repairs stale/missing subject_id values and grants
-- can_manage_workflows to legitimate platform admins. Both are intended
-- end-states, not transient changes to undo - the original NULL/wrong
-- subject_id and the false flag were the bugs. Re-running the up migration
-- is always safe; a true rollback would require knowing the pre-migration
-- values, which we deliberately do not record.

DO $$
BEGIN
    RAISE NOTICE '158: down migration is a no-op (data backfill is not reversible)';
END $$;
