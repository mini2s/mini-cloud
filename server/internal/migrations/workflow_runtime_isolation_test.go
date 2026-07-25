package migrations

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const workflowRuntimeIsolationVersion = "144_workflow_runtime_isolation"

type migrationTestDatabase struct {
	admin       *pgxpool.Pool
	pool        *pgxpool.Pool
	name        string
	migrations  map[string]string
	appliedTill string
}

type legacyWorkflowRun struct {
	runID         string
	nodeRunIDs    []string
	edgeID        string
	deliverableID string
	submissionID  string
}

func TestWorkflowRuntimeIsolationMigrationRejectsNonTerminalLegacyRun(t *testing.T) {
	database := newMigrationDatabaseAt(t, "143_workflow_runtime_selection_policy")
	database.seedLegacyWorkflowRun(t, "running")

	err := database.apply(t, workflowRuntimeIsolationVersion+".up.sql")
	if err == nil || !strings.Contains(err.Error(), "requires all legacy runs to be terminal") {
		t.Fatalf("migration error=%v", err)
	}
	database.assertVersionAbsent(t, workflowRuntimeIsolationVersion)
	database.assertColumnAbsent(t, "multica_workflow_node_run", "source_workflow_node_id")
}

func TestWorkflowRuntimeIsolationMigrationBackfillsTerminalRun(t *testing.T) {
	database := newMigrationDatabaseAt(t, "143_workflow_runtime_selection_policy")
	run := database.seedLegacyWorkflowRun(t, "completed")

	if err := database.apply(t, workflowRuntimeIsolationVersion+".up.sql"); err != nil {
		t.Fatal(err)
	}
	database.assertLegacySnapshot(t, run, 0, "legacy_backfill")
	database.assertRuntimeEdgesAndDeliverablesMapped(t, run)
}

func newMigrationDatabaseAt(t *testing.T, targetVersion string) *migrationTestDatabase {
	t.Helper()
	ctx := context.Background()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://multica:multica@localhost:5432/multica?sslmode=disable"
	}

	baseConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	adminConfig := baseConfig.Copy()
	adminConfig.ConnConfig.Database = "postgres"
	admin, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatalf("connect admin database: %v", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Skipf("PostgreSQL unavailable: %v", err)
	}

	name := fmt.Sprintf("multica_migration_%d_%d", os.Getpid(), time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		admin.Close()
		t.Fatalf("create temporary database: %v", err)
	}

	targetConfig := baseConfig.Copy()
	targetConfig.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, targetConfig)
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP DATABASE "+identifier+" WITH (FORCE)")
		admin.Close()
		t.Fatalf("connect temporary database: %v", err)
	}
	database := &migrationTestDatabase{
		admin:      admin,
		pool:       pool,
		name:       name,
		migrations: make(map[string]string),
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE "+identifier+" WITH (FORCE)")
		admin.Close()
	})

	if _, err := pool.Exec(ctx, `
		CREATE TABLE schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`); err != nil {
		t.Fatalf("create schema_migrations: %v", err)
	}

	files, err := migrationTestFiles("up")
	if err != nil {
		t.Fatalf("list migrations: %v", err)
	}
	foundTarget := false
	for _, file := range files {
		version := ExtractVersion(file)
		database.migrations[filepath.Base(file)] = file
		if version > targetVersion {
			continue
		}
		if err := database.applyPath(ctx, file, version); err != nil {
			t.Fatalf("apply %s: %v", version, err)
		}
		if version == targetVersion {
			foundTarget = true
			database.appliedTill = version
		}
	}
	if !foundTarget {
		t.Fatalf("target migration %s not found", targetVersion)
	}
	return database
}

func (d *migrationTestDatabase) apply(t *testing.T, filename string) error {
	t.Helper()
	path, ok := d.migrations[filename]
	if !ok {
		files, err := migrationTestFiles("up")
		if err != nil {
			return err
		}
		for _, candidate := range files {
			if filepath.Base(candidate) == filename {
				path = candidate
				ok = true
				break
			}
		}
	}
	if !ok {
		return fmt.Errorf("migration %s not found", filename)
	}
	return d.applyPath(context.Background(), path, ExtractVersion(path))
}

func migrationTestFiles(direction string) ([]string, error) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		return nil, fmt.Errorf("resolve migration test source path")
	}
	dir := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations"))
	files, err := filepath.Glob(filepath.Join(dir, "*."+direction+".sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	if direction == "down" {
		sort.Sort(sort.Reverse(sort.StringSlice(files)))
	}
	return files, nil
}

func (d *migrationTestDatabase) applyPath(ctx context.Context, path, version string) error {
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if _, err := d.pool.Exec(ctx, string(body)); err != nil {
		return err
	}
	if _, err := d.pool.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", version); err != nil {
		return err
	}
	return nil
}

func (d *migrationTestDatabase) seedLegacyWorkflowRun(t *testing.T, status string) legacyWorkflowRun {
	t.Helper()
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var workspaceID, userID, workflowID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, '', 'MIG') RETURNING id
	`, "Migration "+suffix, "migration-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_user (name, email) VALUES ($1, $2) RETURNING id
	`, "Migration User", "migration-"+suffix+"@multica.test").Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := d.pool.Exec(ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')
	`, workspaceID, userID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries,
			created_by_type, created_by_id, is_template
		) VALUES ($1, 'Legacy workflow', 'snapshot source', 'active', 2, 'member', $2, false)
		RETURNING id
	`, workspaceID, userID).Scan(&workflowID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}

	var stageID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_stage (workflow_id, name, description, sort_order)
		VALUES ($1, 'Build', 'Build stage', 0) RETURNING id
	`, workflowID).Scan(&stageID); err != nil {
		t.Fatalf("seed stage: %v", err)
	}
	nodeIDs := make([]string, 2)
	for i, title := range []string{"Root", "Child"} {
		if err := d.pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, critic_type, sort_order, stage_id
			) VALUES ($1, $2, $3, $4, 0, $5, 'human', 'human', $6, $7)
			RETURNING id
		`, workflowID, title, title+" description", i*100, []byte(`{"type":"object"}`), i, stageID).Scan(&nodeIDs[i]); err != nil {
			t.Fatalf("seed node %d: %v", i, err)
		}
	}
	var edgeID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id, condition)
		VALUES ($1, $2, $3, '{"kind":"success"}') RETURNING id
	`, workflowID, nodeIDs[0], nodeIDs[1]).Scan(&edgeID); err != nil {
		t.Fatalf("seed edge: %v", err)
	}
	var deliverableID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable (
			workflow_node_id, kind, title, description, required, sort_order
		) VALUES ($1, 'document', 'Legacy report', 'Original requirement', true, 0)
		RETURNING id
	`, nodeIDs[0]).Scan(&deliverableID); err != nil {
		t.Fatalf("seed deliverable: %v", err)
	}

	var runID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status,
			triggered_by_type, triggered_by_id, input, runtime_selection_policy
		) VALUES ($1, $2, 'Legacy workflow', $3, 'member', $4, '{}', 'idle_first')
		RETURNING id
	`, workflowID, workspaceID, status, userID).Scan(&runID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	nodeRunIDs := make([]string, 2)
	for i, nodeID := range nodeIDs {
		nodeStatus := "completed"
		if status == "running" {
			nodeStatus = "working"
		}
		if err := d.pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node_run (
				workflow_run_id, workflow_node_id, node_title, status,
				worker_type, critic_type
			) VALUES ($1, $2, $3, $4, 'human', 'human')
			RETURNING id
		`, runID, nodeID, []string{"Root", "Child"}[i], nodeStatus).Scan(&nodeRunIDs[i]); err != nil {
			t.Fatalf("seed node run %d: %v", i, err)
		}
	}
	var submissionID string
	if err := d.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type,
			status, content
		) VALUES ($1, $2, 'member', 'approved', 'legacy content')
		RETURNING id
	`, nodeRunIDs[0], deliverableID).Scan(&submissionID); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	return legacyWorkflowRun{
		runID: runID, nodeRunIDs: nodeRunIDs, edgeID: edgeID,
		deliverableID: deliverableID, submissionID: submissionID,
	}
}

func (d *migrationTestDatabase) assertVersionAbsent(t *testing.T, version string) {
	t.Helper()
	var exists bool
	if err := d.pool.QueryRow(context.Background(), `
		SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)
	`, version).Scan(&exists); err != nil {
		t.Fatalf("check migration version: %v", err)
	}
	if exists {
		t.Fatalf("migration %s was recorded after failure", version)
	}
}

func (d *migrationTestDatabase) assertColumnAbsent(t *testing.T, table, column string) {
	t.Helper()
	var exists bool
	if err := d.pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
		)
	`, table, column).Scan(&exists); err != nil {
		t.Fatalf("check column: %v", err)
	}
	if exists {
		t.Fatalf("column %s.%s remains after failed migration", table, column)
	}
}

func (d *migrationTestDatabase) assertLegacySnapshot(t *testing.T, run legacyWorkflowRun, schemaVersion int, origin string) {
	t.Helper()
	var gotVersion int
	var gotOrigin string
	var nodeCount, edgeCount, stageCount, deliverableCount int
	err := d.pool.QueryRow(context.Background(), `
		SELECT definition_schema_version,
		       definition_snapshot ->> 'snapshot_origin',
		       jsonb_array_length(definition_snapshot -> 'nodes'),
		       jsonb_array_length(definition_snapshot -> 'edges'),
		       jsonb_array_length(definition_snapshot -> 'stages'),
		       jsonb_array_length(definition_snapshot -> 'deliverables')
		FROM multica_workflow_run WHERE id = $1
	`, run.runID).Scan(&gotVersion, &gotOrigin, &nodeCount, &edgeCount, &stageCount, &deliverableCount)
	if err != nil {
		t.Fatalf("load legacy snapshot: %v", err)
	}
	if gotVersion != schemaVersion || gotOrigin != origin {
		t.Fatalf("snapshot header=(%d,%q), want=(%d,%q)", gotVersion, gotOrigin, schemaVersion, origin)
	}
	if nodeCount != 2 || edgeCount != 1 || stageCount != 1 || deliverableCount != 1 {
		t.Fatalf("snapshot counts nodes=%d edges=%d stages=%d deliverables=%d", nodeCount, edgeCount, stageCount, deliverableCount)
	}
}

func (d *migrationTestDatabase) assertRuntimeEdgesAndDeliverablesMapped(t *testing.T, run legacyWorkflowRun) {
	t.Helper()
	ctx := context.Background()
	var edgeCount int
	if err := d.pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_run_edge WHERE workflow_run_id = $1
	`, run.runID).Scan(&edgeCount); err != nil {
		t.Fatalf("count runtime edges: %v", err)
	}
	if edgeCount != 1 {
		t.Fatalf("runtime edge count=%d", edgeCount)
	}

	var requirementID, sourceDeliverableID, submissionDeliverableID string
	err := d.pool.QueryRow(ctx, `
		SELECT rd.id, rd.source_deliverable_id, submission.deliverable_id
		FROM multica_workflow_node_run_deliverable rd
		JOIN multica_workflow_node_deliverable_submission submission
		  ON submission.workflow_node_run_id = rd.workflow_node_run_id
		WHERE submission.id = $1
	`, run.submissionID).Scan(&requirementID, &sourceDeliverableID, &submissionDeliverableID)
	if err != nil {
		t.Fatalf("load runtime deliverable mapping: %v", err)
	}
	if sourceDeliverableID != run.deliverableID || submissionDeliverableID != requirementID {
		t.Fatalf("deliverable mapping source=%s requirement=%s submission=%s", sourceDeliverableID, requirementID, submissionDeliverableID)
	}

	for i, nodeRunID := range run.nodeRunIDs {
		var sourceNodeID string
		if err := d.pool.QueryRow(ctx, `
			SELECT source_workflow_node_id FROM multica_workflow_node_run WHERE id = $1
		`, nodeRunID).Scan(&sourceNodeID); err != nil {
			t.Fatalf("load source node %d: %v", i, err)
		}
		if sourceNodeID == "" {
			t.Fatalf("node run %d has empty source node", i)
		}
	}
}
