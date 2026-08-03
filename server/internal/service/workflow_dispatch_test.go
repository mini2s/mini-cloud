package service

import (
	"testing"
	"time"
)

func TestWorkflowDispatchBackoffIsBounded(t *testing.T) {
	tests := []struct {
		attempt int32
		want    time.Duration
	}{
		{attempt: 1, want: time.Second},
		{attempt: 2, want: 2 * time.Second},
		{attempt: 6, want: 32 * time.Second},
		{attempt: 7, want: time.Minute},
		{attempt: 100, want: time.Minute},
	}
	for _, test := range tests {
		if got := workflowDispatchBackoff(test.attempt); got != test.want {
			t.Errorf("attempt %d backoff=%s, want %s", test.attempt, got, test.want)
		}
	}
}
