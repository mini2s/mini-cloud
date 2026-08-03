package execenv

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// writeFakeCSC writes a shell script that simulates the csc CLI.
// commands is a map of command substring -> exit code (0=success, 1=fail).
// The script logs every invocation to {dir}/invocations.log for verification.
func writeFakeCSC(t *testing.T, dir string, commands map[string]int) string {
	t.Helper()
	var script strings.Builder
	script.WriteString("#!/bin/sh\n")
	script.WriteString("echo \"$@\" >> " + filepath.Join(dir, "invocations.log") + "\n")
	for substr, exitCode := range commands {
		script.WriteString("echo \"$@\" | grep -q '" + substr + "' && exit " + strconvItoa(exitCode) + "\n")
	}
	script.WriteString("exit 0\n")

	path := filepath.Join(dir, "csc")
	if err := os.WriteFile(path, []byte(script.String()), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// strconvItoa converts a small non-negative int to its decimal string.
func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [16]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}

func readInvocations(t *testing.T, dir string) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "invocations.log"))
	if err != nil {
		return nil
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

func writeFailingCommand(t *testing.T, dir string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "csc.cmd")
		script := "@echo off\r\necho Refreshing marketplace cache\r\necho fatal: TLS connect error 1>&2\r\nexit /b 42\r\n"
		if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	path := filepath.Join(dir, "csc")
	script := "#!/bin/sh\necho 'Refreshing marketplace cache'\necho 'fatal: TLS connect error' >&2\nexit 42\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeUVSuccessCommand(t *testing.T, dir string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "csc.cmd")
		script := "@echo off\r\necho 正在更新市场: costrict-plugins...\r\necho √ 成功更新市场: costrict-plugins\r\necho Assertion failed: !(handle-^>flags ^& UV_HANDLE_CLOSING), file src\\win\\async.c, line 76 1>&2\r\nexit /b 1\r\n"
		if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	path := filepath.Join(dir, "csc")
	script := "#!/bin/sh\necho '正在更新市场: costrict-plugins...'\necho '√ 成功更新市场: costrict-plugins'\necho 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src/win/async.c, line 76' >&2\nexit 1\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRunCSCCmdErrorIncludesCommandOutput(t *testing.T) {
	dir := t.TempDir()
	fakeBin := writeFailingCommand(t, dir)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := runCSCCmd(context.Background(), fakeBin, workDir, "plugin", "marketplace", "update", "costrict-plugins")
	if err == nil {
		t.Fatal("expected error")
	}
	errText := err.Error()
	if !strings.Contains(errText, "Refreshing marketplace cache") {
		t.Fatalf("expected stdout in error, got: %v", err)
	}
	if !strings.Contains(errText, "fatal: TLS connect error") {
		t.Fatalf("expected stderr in error, got: %v", err)
	}
}

func TestRunCSCCmdTreatsSuccessOutputWithUVAssertionAsSuccess(t *testing.T) {
	dir := t.TempDir()
	fakeBin := writeUVSuccessCommand(t, dir)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := runCSCCmd(context.Background(), fakeBin, workDir, "plugin", "marketplace", "update", "costrict-plugins")
	if err != nil {
		t.Fatalf("expected success output to win over post-command UV assertion, got %v", err)
	}
}

// testPlugin returns a standard plugin for testing.
func testPlugin() *AgentPlugin {
	return &AgentPlugin{
		ID:   "test-plugin-id",
		Name: "cospower",
		Install: &PluginInstall{
			Method:              "plugin_marketplace",
			Marketplace:         "example/marketplace",
			PluginName:          "cospower",
			MarketplaceName:     "marketplace",
			MarketplaceRepo:     "https://github.com/example/marketplace.git",
			MarketplaceVerified: true,
		},
	}
}

func TestSetupPlugins_DispatchesToCSC(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, nil)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupPlugins(context.Background(), "csc", fakeBin, workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}

	invocations := readInvocations(t, dir)
	if len(invocations) < 3 {
		t.Fatalf("expected at least 3 invocations (add+update+install), got %d: %v", len(invocations), invocations)
	}
}

func TestSetupPlugins_UnknownProviderSkips(t *testing.T) {
	dir := t.TempDir()
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupPlugins(context.Background(), "claude", "/usr/bin/claude", workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("unknown provider should skip silently, got: %v", err)
	}
}

func TestSetupPlugins_EmptyPluginsSkips(t *testing.T) {
	dir := t.TempDir()
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupPlugins(context.Background(), "csc", "/usr/bin/csc", workDir, nil, slog.Default())
	if err != nil {
		t.Fatalf("empty plugins should skip silently, got: %v", err)
	}
}

func TestSetupPlugins_EmptyBinSkips(t *testing.T) {
	dir := t.TempDir()
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupPlugins(context.Background(), "csc", "", workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("empty bin should skip silently, got: %v", err)
	}
}

func TestSetupCSCPlugins_Success(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, nil)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), fakeBin, workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}

	// Expected sequence: marketplace add + marketplace update + install + update.
	invocations := readInvocations(t, dir)
	if len(invocations) != 4 {
		t.Fatalf("expected 4 invocations, got %d: %v", len(invocations), invocations)
	}
	if !strings.Contains(invocations[0], "plugin marketplace add") {
		t.Errorf("first invocation should be marketplace add, got: %s", invocations[0])
	}
	if !strings.Contains(invocations[0], "https://github.com/example/marketplace.git") {
		t.Errorf("marketplace add should use delivered repo, got: %s", invocations[0])
	}
	if !strings.Contains(invocations[1], "plugin marketplace update") {
		t.Errorf("second invocation should be marketplace update, got: %s", invocations[1])
	}
	if !strings.Contains(invocations[1], "marketplace") {
		t.Errorf("marketplace update should mention delivered name, got: %s", invocations[1])
	}
	if !strings.Contains(invocations[2], "plugin install") {
		t.Errorf("third invocation should be plugin install, got: %s", invocations[2])
	}
	if !strings.Contains(invocations[2], "cospower@marketplace") {
		t.Errorf("install should use spec cospower@marketplace, got: %s", invocations[2])
	}
	if !strings.Contains(invocations[2], "-s local") {
		t.Errorf("install should use -s local scope, got: %s", invocations[2])
	}
	if !strings.Contains(invocations[3], "plugin update cospower@marketplace") {
		t.Errorf("fourth invocation should be plugin update cospower@marketplace, got: %s", invocations[3])
	}
	if !strings.Contains(invocations[3], "-s local") {
		t.Errorf("update should use -s local scope, got: %s", invocations[3])
	}
	// Verify no --dir flag
	for _, inv := range invocations {
		if strings.Contains(inv, "--dir") {
			t.Errorf("commands should not use --dir flag, got: %s", inv)
		}
	}
}

func TestSetupCSCPlugins_MarketplaceAddNonFatal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	// marketplace add fails, but it is non-fatal — the marketplace may
	// already be registered — so the remaining steps must still run.
	fakeBin := writeFakeCSC(t, dir, map[string]int{"marketplace add": 1})
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), fakeBin, workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("marketplace add is non-fatal; expected nil error, got: %v", err)
	}
	// All four commands still ran despite the add failure.
	invocations := readInvocations(t, dir)
	if len(invocations) != 4 {
		t.Fatalf("expected 4 invocations despite add failure, got %d: %v", len(invocations), invocations)
	}
}

func TestSetupCSCPlugins_UpdateFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, map[string]int{"plugin update": 1})
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), fakeBin, workDir, testPlugin(), slog.Default())
	if err == nil {
		t.Fatal("expected error when plugin update fails")
	}
	if !strings.Contains(err.Error(), "plugin update") {
		t.Errorf("error should mention plugin update, got: %v", err)
	}
}

func TestSetupCSCPlugins_InstallFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, map[string]int{"plugin install": 1})
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), fakeBin, workDir, testPlugin(), slog.Default())
	if err == nil {
		t.Fatal("expected error when plugin install fails")
	}
	if !strings.Contains(err.Error(), "plugin install") {
		t.Errorf("error should mention plugin install, got: %v", err)
	}
}

func TestSetupCSCPlugins_EmptyPlugins(t *testing.T) {
	dir := t.TempDir()
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), "/usr/bin/csc", workDir, nil, slog.Default())
	if err != nil {
		t.Fatalf("empty plugins should succeed, got: %v", err)
	}
}

func TestSetupCSCPlugins_EmptyCSCBin(t *testing.T) {
	dir := t.TempDir()
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := setupCSCPlugins(context.Background(), "", workDir, testPlugin(), slog.Default())
	if err != nil {
		t.Fatalf("empty cscBin should succeed, got: %v", err)
	}
}

func TestSetupCSCPlugins_Timeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\nsleep 300\n"
	fakeBin := filepath.Join(dir, "csc")
	if err := os.WriteFile(fakeBin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := setupCSCPlugins(ctx, fakeBin, workDir, testPlugin(), slog.Default())
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSetupCSCPlugins_ErrorMessageContainsMarketplace(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	// marketplace update is fatal; its error must name the marketplace so
	// operators can see which one failed.
	fakeBin := writeFakeCSC(t, dir, map[string]int{"marketplace update": 1})
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	plugin := testPlugin()
	err := setupCSCPlugins(context.Background(), fakeBin, workDir, plugin, slog.Default())
	if err == nil {
		t.Fatal("expected error when marketplace update fails")
	}
	if !strings.Contains(err.Error(), plugin.Install.MarketplaceName) {
		t.Errorf("error should contain marketplace name %q, got: %v", plugin.Install.MarketplaceName, err)
	}
}

// TestSetupCSCPlugins_UsesDeliveredMarketplace verifies the marketplace
// identity delivered by the server (via the task-claim response) is what the
// daemon registers against — not the built-in github default.
func TestSetupCSCPlugins_UsesDeliveredMarketplace(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, nil)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	plugin := &AgentPlugin{
		Name: "cospower",
		Install: &PluginInstall{
			Method:          "plugin_marketplace",
			PluginName:      "cospower",
			MarketplaceName: "custom-market",
			MarketplaceRepo: "https://github.com/custom/repo.git",
		},
	}
	if err := setupCSCPlugins(context.Background(), fakeBin, workDir, plugin, slog.Default()); err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}

	log := strings.Join(readInvocations(t, dir), "\n")
	if !strings.Contains(log, "marketplace add https://github.com/custom/repo.git") {
		t.Errorf("expected marketplace add with delivered repo, got:\n%s", log)
	}
	if !strings.Contains(log, "marketplace update custom-market") {
		t.Errorf("expected marketplace update with delivered name, got:\n%s", log)
	}
	if !strings.Contains(log, "cospower@custom-market") {
		t.Errorf("expected install spec cospower@custom-market, got:\n%s", log)
	}
	// The built-in default must not leak into the delivered-value path.
	if strings.Contains(log, defaultCSCMarketplaceName) {
		t.Errorf("built-in default marketplace name %q leaked when a value was delivered", defaultCSCMarketplaceName)
	}
}

// TestSetupCSCPlugins_FallsBackToDefaultWhenEmpty verifies that when the
// server delivers no marketplace identity (empty fields — e.g. an older
// server build), the daemon falls back to its built-in github default so the
// install still targets the canonical marketplace.
func TestSetupCSCPlugins_FallsBackToDefaultWhenEmpty(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake not supported on windows")
	}
	dir := t.TempDir()
	fakeBin := writeFakeCSC(t, dir, nil)
	workDir := filepath.Join(dir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	plugin := &AgentPlugin{
		Name: "cospower",
		Install: &PluginInstall{
			Method:     "plugin_marketplace",
			PluginName: "cospower",
			// MarketplaceName / MarketplaceRepo intentionally empty.
		},
	}
	if err := setupCSCPlugins(context.Background(), fakeBin, workDir, plugin, slog.Default()); err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}

	log := strings.Join(readInvocations(t, dir), "\n")
	if !strings.Contains(log, "marketplace add "+defaultCSCMarketplaceRepo) {
		t.Errorf("expected marketplace add with default repo, got:\n%s", log)
	}
	if !strings.Contains(log, "marketplace update "+defaultCSCMarketplaceName) {
		t.Errorf("expected marketplace update with default name, got:\n%s", log)
	}
	if !strings.Contains(log, "cospower@"+defaultCSCMarketplaceName) {
		t.Errorf("expected install spec cospower@%s, got:\n%s", defaultCSCMarketplaceName, log)
	}
}
