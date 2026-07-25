package service

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
)

func TestRuntimeFilesDoNotReadWorkflowDefinitionTables(t *testing.T) {
	files := []string{"workflow.go", "workflow_runtime_selection.go", "task.go", "task_cscloud_push.go"}
	for _, name := range files {
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{
			"GetWorkflowNode(ctx", "ListWorkflowEdgesBySource(ctx", "ListWorkflowEdgesByTarget(ctx",
		} {
			if bytes.Contains(body, []byte(forbidden)) {
				t.Errorf("%s contains runtime definition read %s", name, forbidden)
			}
		}
	}
}

func TestRuntimeRepositorySurvivesDefinitionMutation(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	var childNodeRunID pgtype.UUID
	if err := fixture.pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status,
			worker_type, critic_type, format_schema
		) VALUES ($1, gen_random_uuid(), 'Runtime child', 'pending', 'human', 'human', '{}'::jsonb)
		RETURNING id
	`, fixture.runID).Scan(&childNodeRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		INSERT INTO multica_workflow_run_edge (
			workflow_run_id, source_node_run_id, target_node_run_id, condition
		) VALUES ($1, $2, $3, '{}'::jsonb)
	`, fixture.runID, fixture.nodeRunID, childNodeRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		DELETE FROM multica_workflow_node
		WHERE id = (
			SELECT source_workflow_node_id
			FROM multica_workflow_node_run
			WHERE id = $1
		)
	`, fixture.nodeRunID); err != nil {
		t.Fatal(err)
	}

	runtime := WorkflowRuntimeRepository{Queries: fixture.queries}
	config, err := runtime.GetRunNodeConfig(fixture.ctx, fixture.nodeRunID)
	if err != nil {
		t.Fatal(err)
	}
	if config.WorkerID != fixture.agentID {
		t.Fatalf("worker id=%v, want original %v", config.WorkerID, fixture.agentID)
	}
	edges, err := runtime.ListRunEdgesBySource(fixture.ctx, fixture.nodeRunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(edges) != 1 {
		t.Fatalf("runtime edges=%d, want 1", len(edges))
	}
	if got, want := []pgtype.UUID{edges[0].TargetNodeRunID}, []pgtype.UUID{childNodeRunID}; !reflect.DeepEqual(got, want) {
		t.Fatalf("target node runs=%v, want %v", got, want)
	}
	contextJSON, err := fixture.service.TaskSvc.buildWorkflowTaskContext(fixture.ctx, fixture.nodeRunID, "worker")
	if err != nil {
		t.Fatal(err)
	}
	var taskContext map[string]any
	if err := json.Unmarshal(contextJSON, &taskContext); err != nil {
		t.Fatal(err)
	}
	if got := taskContext["workflow_node_id"]; got != util.UUIDToString(config.SourceNodeID) {
		t.Fatalf("workflow_node_id=%v, want source id %s", got, util.UUIDToString(config.SourceNodeID))
	}
	if got := taskContext["node_title"]; got != "Dispatch node" {
		t.Fatalf("node_title=%v, want snapshot title", got)
	}
	topo, err := RunNodeTopoOrder(fixture.ctx, fixture.queries, fixture.runID)
	if err != nil {
		t.Fatal(err)
	}
	if topo[util.UUIDToString(fixture.nodeRunID)] != 1 || topo[util.UUIDToString(childNodeRunID)] != 2 {
		t.Fatalf("runtime topo=%v, want root=1 child=2", topo)
	}
}
