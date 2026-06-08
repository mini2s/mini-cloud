-- Clean up the unreleased per-multica_agent local multica_skill toggle. Fresh/prod databases
-- that never applied 108_agent_skills_local are unchanged, while dev/staging
-- databases that tested it converge back to the reverted schema.
ALTER TABLE multica_agent DROP COLUMN IF EXISTS skills_local;
