package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateWorkflowCreatesDefaultBoundaries(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/workflows", map[string]any{
		"title": "Default boundaries",
	})
	testHandler.CreateWorkflow(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateWorkflow: got %d: %s", w.Code, w.Body.String())
	}

	var response WorkflowResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM multica_workflow WHERE id = $1`, response.ID)
	})

	if response.NodeCount != 2 {
		t.Fatalf("node_count = %d, want 2", response.NodeCount)
	}

	rows, err := testPool.Query(context.Background(), `
		SELECT title, format_schema->>'type', format_schema->>'shape',
		       format_schema->>'template_id', format_schema->>'template_category',
		       position_x, position_y, sort_order,
		       worker_id IS NULL, worker_role_id IS NULL,
		       critic_id IS NULL, critic_role_id IS NULL,
		       critic_api_url IS NULL, stage_id IS NULL
		FROM multica_workflow_node
		WHERE workflow_id = $1
		ORDER BY sort_order`, response.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	type boundary struct {
		title, kind, shape, templateID, templateCategory string
		x, y                                             float64
		sortOrder                                        int32
		workerIDNull, workerRoleIDNull                   bool
		criticIDNull, criticRoleIDNull                   bool
		criticAPINull, stageIDNull                       bool
	}
	var got []boundary
	for rows.Next() {
		var item boundary
		if err := rows.Scan(
			&item.title,
			&item.kind,
			&item.shape,
			&item.templateID,
			&item.templateCategory,
			&item.x,
			&item.y,
			&item.sortOrder,
			&item.workerIDNull,
			&item.workerRoleIDNull,
			&item.criticIDNull,
			&item.criticRoleIDNull,
			&item.criticAPINull,
			&item.stageIDNull,
		); err != nil {
			t.Fatal(err)
		}
		got = append(got, item)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d nodes, want 2", len(got))
	}

	assertBoundary := func(
		item boundary,
		title string,
		kind string,
		templateID string,
		x float64,
		sortOrder int32,
	) {
		t.Helper()
		if item.title != title || item.kind != kind || item.shape != "pill" ||
			item.templateID != templateID || item.templateCategory != "trigger" ||
			item.x != x || item.y != 0 || item.sortOrder != sortOrder {
			t.Fatalf("unexpected %s node: %#v", title, item)
		}
		if !item.workerIDNull || !item.workerRoleIDNull ||
			!item.criticIDNull || !item.criticRoleIDNull ||
			!item.criticAPINull || !item.stageIDNull {
			t.Fatalf("%s actor and stage fields must be null: %#v", title, item)
		}
	}

	assertBoundary(got[0], "Start", "start", "workflow-start", 120, 0)
	assertBoundary(got[1], "End", "end", "workflow-end", 600, 1)
}

func TestCreateWorkflowDefaultBoundaryFailureRollsBack(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	_, _ = testPool.Exec(ctx,
		`DROP TRIGGER IF EXISTS test_fail_default_workflow_end_trigger ON multica_workflow_node`)
	_, _ = testPool.Exec(ctx,
		`DROP FUNCTION IF EXISTS test_fail_default_workflow_end()`)
	_, err := testPool.Exec(ctx, `
		CREATE FUNCTION test_fail_default_workflow_end() RETURNS trigger AS $$
		BEGIN
			IF NEW.title = 'End' AND EXISTS (
				SELECT 1 FROM multica_workflow
				WHERE id = NEW.workflow_id AND title = 'Rollback boundaries test'
			) THEN
				RAISE EXCEPTION 'forced default End failure';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER test_fail_default_workflow_end_trigger
		BEFORE INSERT ON multica_workflow_node
		FOR EACH ROW EXECUTE FUNCTION test_fail_default_workflow_end();`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(),
			`DROP TRIGGER IF EXISTS test_fail_default_workflow_end_trigger ON multica_workflow_node`)
		_, _ = testPool.Exec(context.Background(),
			`DROP FUNCTION IF EXISTS test_fail_default_workflow_end()`)
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM multica_workflow WHERE title = 'Rollback boundaries test'`)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/workflows", map[string]any{
		"title": "Rollback boundaries test",
	})
	testHandler.CreateWorkflow(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("CreateWorkflow: got %d, want 500: %s", w.Code, w.Body.String())
	}

	var count int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*)
		FROM multica_workflow
		WHERE title = 'Rollback boundaries test'
	`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("rolled-back workflow count = %d, want 0", count)
	}
}
