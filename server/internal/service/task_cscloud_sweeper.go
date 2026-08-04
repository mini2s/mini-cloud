package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	// csCloudSessionProbeMinRunningSecs is how long a cs-cloud workflow task
	// must have been running before the sweeper probes its CSC session. The
	// device-side session is established asynchronously after dispatch, so
	// probing too early yields false "no session" (session_id not yet pinned)
	// or a transient 404. 2 minutes is well past the session-setup window.
	csCloudSessionProbeMinRunningSecs = 120.0
	// csCloudSessionProbeTimeout caps a single device probe HTTP call so one
	// slow device cannot stall a sweep tick.
	csCloudSessionProbeTimeout = 10 * time.Second
	// csCloudSessionProbeConcurrency limits parallel probes per sweep tick.
	csCloudSessionProbeConcurrency = 5
)

// SweepStaleWorkflowTaskSessions probes running cs-cloud workflow tasks whose
// bound CSC session may have ended without the agent reporting completion -
// the agent finished its work but never called `cs-cloud workflow task
// complete`, or the session died from a timeout/permission hang. When the
// device reports the session gone (HTTP 404), the task is failed with
// failure_reason='timeout' so the existing auto-retry path re-dispatches the
// node run instead of leaving it stuck for the full 2.5h task sweeper.
//
// Only a definitive 404 triggers failure. Any other status, transport error,
// timeout, or a task with no session binding is skipped - sweepStaleTasks
// remains the backstop. This keeps the probe safe: it can never fail a task
// whose session is merely unverified.
func (s *TaskService) SweepStaleWorkflowTaskSessions(ctx context.Context) {
	if s.CSCloudPush == nil || !s.CSCloudPush.Enabled() {
		return
	}
	rows, err := s.Queries.ListRunningCSCloudWorkflowTasksForProbe(ctx, csCloudSessionProbeMinRunningSecs)
	if err != nil {
		slog.Warn("workflow session sweeper: list candidates failed", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	sem := make(chan struct{}, csCloudSessionProbeConcurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	failed := 0

	for _, row := range rows {
		row := row
		sessionID := pickCSCSessionID(row)
		if sessionID == "" {
			continue // no session binding to probe; backstop is the 2.5h sweeper
		}
		deviceID, err := csCloudDeviceID(db.MulticaAgentRuntime{
			Metadata: row.RuntimeMetadata,
			DaemonID: row.RuntimeDaemonID,
		})
		if err != nil {
			slog.Debug("workflow session sweeper: no device id",
				"task_id", util.UUIDToString(row.ID), "error", err)
			continue
		}

		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if !s.probeCSCSessionGone(ctx, deviceID, sessionID) {
				return
			}
			if _, fErr := s.FailTask(ctx, row.ID,
				"csc session ended without a completion signal",
				sessionID, row.WorkDir.String, "timeout"); fErr != nil {
				slog.Warn("workflow session sweeper: fail task failed",
					"task_id", util.UUIDToString(row.ID), "error", fErr)
				return
			}
			mu.Lock()
			failed++
			mu.Unlock()
			slog.Info("workflow session sweeper: failed task with gone csc session",
				"task_id", util.UUIDToString(row.ID),
				"node_run_id", util.UUIDToString(row.WorkflowNodeRunID),
				"session_id", sessionID)
		}()
	}
	wg.Wait()

	if failed > 0 {
		slog.Info("workflow session sweeper: probed cs-cloud workflow tasks",
			"candidates", len(rows), "failed", failed)
	}
}

// probeCSCSessionGone returns true only when the device definitively reports
// the CSC session does not exist (HTTP 404). Any other status, transport
// error, or timeout returns false - the caller leaves the task alone and the
// 2.5h sweepStaleTasks backstop applies. The probe mirrors the
// verifyConversationOnDevice path (issue_conversation.go) but uses the
// internal-route auth that dispatch/abort use (X-Internal-Secret only), since
// the sweeper has no user context.
func (s *TaskService) probeCSCSessionGone(ctx context.Context, deviceID, sessionID string) bool {
	probeCtx, cancel := context.WithTimeout(ctx, csCloudSessionProbeTimeout)
	defer cancel()

	req := cloudruntime.Request{
		Method:  http.MethodGet,
		Path:    fmt.Sprintf("/device/%s/proxy/api/v1/conversations/%s", deviceID, sessionID),
		Headers: http.Header{},
	}
	if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
		req.Headers.Set("X-Internal-Secret", secret)
	}

	resp, err := s.CSCloudPush.Do(probeCtx, req)
	if err != nil {
		return false // transport error / timeout - inconclusive
	}
	return resp.StatusCode == http.StatusNotFound
}

// pickCSCSessionID resolves the CSC session id to probe: prefer the task's
// pinned session_id, fall back to the node-run binding (written
// asynchronously by the daemon/cs-cloud). Empty means nothing to probe.
func pickCSCSessionID(row db.ListRunningCSCloudWorkflowTasksForProbeRow) string {
	if row.SessionID.Valid && row.SessionID.String != "" {
		return row.SessionID.String
	}
	if row.NodeRunSessionID.Valid && row.NodeRunSessionID.String != "" {
		return row.NodeRunSessionID.String
	}
	return ""
}
