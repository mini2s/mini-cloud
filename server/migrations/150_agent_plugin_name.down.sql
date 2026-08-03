-- 150_agent_plugin_name.down.sql
ALTER TABLE multica_agent DROP COLUMN IF EXISTS plugin_name;
