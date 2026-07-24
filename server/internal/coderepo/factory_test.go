package coderepo

import (
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/gitea"
)

func TestFactoryReturnsGiteaAdapter(t *testing.T) {
	client := gitea.NewClient(gitea.Config{
		BaseURL: "https://repo.example.com",
		Token:   "secret",
	})

	provider, err := NewFactory(FactoryConfig{Gitea: client}).Provider(ProviderGitea)
	if err != nil {
		t.Fatalf("Provider(gitea): %v", err)
	}
	if provider.Name() != ProviderGitea {
		t.Fatalf("provider name = %q", provider.Name())
	}
	if !provider.Configured() {
		t.Fatal("provider should report configured")
	}
}

func TestFactoryRejectsUnsupportedProvider(t *testing.T) {
	_, err := NewFactory(FactoryConfig{}).Provider(Provider("github"))
	if err == nil {
		t.Fatal("expected unsupported provider error")
	}
	if !strings.Contains(err.Error(), "unsupported repository provider") {
		t.Fatalf("error = %v", err)
	}
}
