import { describe, it, expect } from "vitest";
import { isValidGitRepoURL } from "./repo-url";

// Good/bad lists mirror server/internal/handler/project_resource_test.go so
// the TS and Go validators stay in lockstep.
describe("isValidGitRepoURL", () => {
  const good = [
    "https://github.com/multica-ai/multica",
    "https://github.com/multica-ai/multica.git",
    "http://github.example.com/x/y",
    "ssh://git@github.com/multica-ai/multica.git",
    "ssh://git@github.com:22/multica-ai/multica.git",
    "git@github.com:multica-ai/multica.git",
    "git@gitlab.example.com:group/sub/repo.git",
  ];
  const bad = [
    "",
    "not-a-url",
    "github.com/multica-ai/multica",
    "https://",
    "git@github.com",
    "git@:foo/bar",
    "git@github.com:",
    "ftp://example.com/repo",
    "file:///tmp/repo",
    "some random text with spaces",
    "github.com:org/repo@branch",
    "foo:bar@baz",
    ":foo/bar",
  ];
  for (const s of good) {
    it(`accepts ${s || "(empty string was in bad)"}`, () => {
      expect(isValidGitRepoURL(s)).toBe(true);
    });
  }
  for (const s of bad) {
    it(`rejects "${s}"`, () => {
      expect(isValidGitRepoURL(s)).toBe(false);
    });
  }
});
