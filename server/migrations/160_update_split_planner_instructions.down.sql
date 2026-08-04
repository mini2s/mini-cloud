-- Reverting would restore Instructions that reference the retired split draft
-- CLI (`cs-workflow workflow split draft add/submit`), which no longer exists
-- in cs-cloud. Intentionally a no-op — the old Instructions are broken.
SELECT 1;
