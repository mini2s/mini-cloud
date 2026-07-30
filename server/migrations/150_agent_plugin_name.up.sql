-- 150_agent_plugin_name.up.sql
-- Add plugin_name to multica_agent: the stable install identifier (slug) of the
-- bound plugin, e.g. "cospowers-integration-verification".
--
-- Why: cs-cloud installs a plugin by NAME (`csc plugin install <name>@<mp>`),
-- but the agent previously stored only plugin_id — a catalog UUID that changes
-- every time the plugin catalog is rebuilt. resolveCSCloudAddons had to call
-- plugincatalog.Fetch(plugin_id) to recover the name, and a stale id (404)
-- silently dropped the plugin from the dispatch payload. plugin_name is the
-- stable slug the install path actually needs, stored at bind time, so the
-- download chain no longer depends on a fragile id->catalog lookup.
--
-- Backfill the built-in cospowers roster (seeded by 124) with their stable
-- plugin slugs. Only touches rows where plugin_name is still NULL, so a value
-- set manually (or by a future rebind) is never clobbered.

ALTER TABLE multica_agent ADD COLUMN IF NOT EXISTS plugin_name TEXT;

UPDATE multica_agent SET plugin_name = 'cospowers-requirements'
WHERE id = 'dd0683f4-d72c-4b49-8030-827f5b15df2e' AND plugin_name IS NULL;
UPDATE multica_agent SET plugin_name = 'cospowers-solution-design'
WHERE id = '5e2fccac-6257-4ea5-ac7a-a5d8a4765917' AND plugin_name IS NULL;
UPDATE multica_agent SET plugin_name = 'cospowers-task-planning'
WHERE id = '4348e20d-eadc-4095-ac7a-cd480e927375' AND plugin_name IS NULL;
UPDATE multica_agent SET plugin_name = 'cospowers-tdd-development'
WHERE id = 'c0bea924-c78f-43b1-8d50-449ec3c6b4cf' AND plugin_name IS NULL;
UPDATE multica_agent SET plugin_name = 'cospowers-test-generation'
WHERE id = '67cdded4-c49f-4fc3-b7e0-52aa2038db91' AND plugin_name IS NULL;
UPDATE multica_agent SET plugin_name = 'cospowers-integration-verification'
WHERE id = '24a981c1-6ea6-4eab-9225-a5fe3da64477' AND plugin_name IS NULL;
