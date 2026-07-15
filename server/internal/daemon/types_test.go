package daemon

import (
	"encoding/json"
	"testing"
)

func TestAgentData_DecodesCloudSkills(t *testing.T) {
	var agent AgentData
	err := json.Unmarshal([]byte(`{
		"id":"agent-1",
		"name":"Cloud Agent",
		"cloud_skills":[
			{
				"id":"11111111-1111-4111-8111-111111111111",
				"slug":"first-skill",
				"name":"First Skill",
				"description":"first",
				"install":{"method":"csc","spec":"first-skill","skill_id":"11111111-1111-4111-8111-111111111111","source_url":"https://example.test/first","verified":true},
				"position":0
			},
			{
				"id":"22222222-2222-4222-8222-222222222222",
				"slug":"second-skill",
				"name":"Second Skill",
				"description":"second",
				"install":{"method":"csc_skill","skill_id":"22222222-2222-4222-8222-222222222222"},
				"position":1
			}
		]
	}`), &agent)
	if err != nil {
		t.Fatalf("decode AgentData: %v", err)
	}
	if len(agent.CloudSkills) != 2 {
		t.Fatalf("cloud skills count = %d, want 2", len(agent.CloudSkills))
	}
	if got := agent.CloudSkills[0].Slug; got != "first-skill" {
		t.Fatalf("first slug = %q", got)
	}
	if got := agent.CloudSkills[0].Install.SourceURL; got != "https://example.test/first" {
		t.Fatalf("first install source_url = %q", got)
	}
	if !agent.CloudSkills[0].Install.Verified {
		t.Fatal("first install verified = false, want true")
	}
	if got := agent.CloudSkills[1].Install.Method; got != "csc_skill" {
		t.Fatalf("second install method = %q", got)
	}
	if got := agent.CloudSkills[1].Position; got != 1 {
		t.Fatalf("second position = %d, want 1", got)
	}
}
