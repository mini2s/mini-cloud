-- Add event_filters to multica_autopilot_trigger so webhook triggers can declare
-- which events/actions they care about. NULL means "accept all" (backward
-- compatible). JSONB shape: [{"event": "multica_workflow_run", "actions": ["completed"]}, …]
ALTER TABLE multica_autopilot_trigger
    ADD COLUMN event_filters JSONB;
