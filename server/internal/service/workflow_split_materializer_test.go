package service

import (
	"testing"
	"time"
)

func TestSplitMaterializationRetryScheduleAllowsFourExecutions(t *testing.T) {
	now := time.Date(2026, time.August, 3, 12, 0, 0, 0, time.UTC)
	wants := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}
	for retryCount, wantDelay := range wants {
		nextCount, nextAttempt, exhausted := splitMaterializationNextAttempt(int32(retryCount), now)
		if exhausted {
			t.Fatalf("retry count %d exhausted before fourth execution", retryCount)
		}
		if nextCount != int32(retryCount+1) || !nextAttempt.Valid || nextAttempt.Time.Sub(now) != wantDelay {
			t.Fatalf("retry count %d = (%d, %v), want delay %s", retryCount, nextCount, nextAttempt, wantDelay)
		}
	}
	nextCount, nextAttempt, exhausted := splitMaterializationNextAttempt(3, now)
	if !exhausted || nextCount != 4 || nextAttempt.Valid {
		t.Fatalf("fourth execution = (%d, %v, exhausted=%v), want exhausted", nextCount, nextAttempt, exhausted)
	}
}
