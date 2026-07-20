-- 137_seed_split_planner_agents.down.sql
-- Remove only the split planner agents introduced by this migration.

DELETE FROM multica_agent WHERE id IN (
    'dd79d98e-3be1-4cb5-9cdd-aee809287741',
    '3ef3f4fd-0de7-4a84-a03d-cb5d4df2f30c',
    '32fc6f0c-2f00-44d7-a6a2-36f1d75a144a',
    '6b3ea222-f3ee-44c5-b4c9-33a1674a1127'
);
