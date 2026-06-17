package daemon

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/multica-ai/multica/server/pkg/agent"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// StreamForwarder converts agent.Message events into task:stream WebSocket
// frames and forwards them to the supplied send function. Send failures are
// dropped so the agent execution never blocks on network latency.
type StreamForwarder struct {
	send   func([]byte) bool
	logger *slog.Logger
	seqs   sync.Map // taskID -> *atomic.Int32
}

// NewStreamForwarder creates a forwarder. send must be non-blocking; it
// returns true if the frame was accepted.
func NewStreamForwarder(send func([]byte) bool, logger *slog.Logger) *StreamForwarder {
	if logger == nil {
		logger = slog.Default()
	}
	return &StreamForwarder{send: send, logger: logger}
}

// Send maps one agent.Message to a task:stream frame and forwards it.
func (f *StreamForwarder) Send(ctx context.Context, taskID, issueID, workspaceID string, msg agent.Message) {
	if f.send == nil || taskID == "" {
		return
	}
	payload := protocol.TaskStreamPayload{
		TaskID:      taskID,
		IssueID:     issueID,
		WorkspaceID: workspaceID,
		Seq:         f.nextSeq(taskID),
		Type:        string(msg.Type),
		Content:     msg.Content,
		Tool:        msg.Tool,
		CallID:      msg.CallID,
		Input:       msg.Input,
		Output:      msg.Output,
		Status:      msg.Status,
		Level:       msg.Level,
		Timestamp:   time.Now().UnixMilli(),
	}
	frame, err := json.Marshal(protocol.Message{
		Type:    protocol.EventTaskStream,
		Payload: mustMarshalRaw(payload),
	})
	if err != nil {
		f.logger.Debug("stream forwarder: marshal failed", "error", err, "task_id", taskID)
		return
	}
	if !f.send(frame) {
		f.logger.Debug("stream forwarder: frame dropped", "task_id", taskID)
	}
}

func (f *StreamForwarder) nextSeq(taskID string) int {
	v, _ := f.seqs.LoadOrStore(taskID, new(atomic.Int32))
	return int(v.(*atomic.Int32).Add(1))
}

func mustMarshalRaw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
