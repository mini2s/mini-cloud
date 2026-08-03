"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@multica/core/api";
import { useIdentities } from "@multica/core/channels";
import type { AuthIdentity } from "@multica/core/channels";
import { useAuthStore } from "@multica/core/auth";
import { useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "@multica/core/channels";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../../i18n";

// Providers managed by this tab, in display order. Matches the source page.
const ALL_PROVIDERS = ["idtrust", "github", "phone"] as const;
type ProviderKey = (typeof ALL_PROVIDERS)[number];

const PROVIDER_COLOR: Record<string, string> = {
  idtrust: "#2563eb",
  github: "#24292f",
  phone: "#16a34a",
};

export function IdentitiesTab() {
  const { t } = useT("settings");
  const { t: tc } = useT("common");
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);

  const identitiesQ = useIdentities();
  const identities = identitiesQ.data ?? [];
  const visibleIdentities = identities.filter((i) =>
    (ALL_PROVIDERS as readonly string[]).includes(i.provider),
  );

  const [unbindingProvider, setUnbindingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindSuccess, setBindSuccess] = useState(false);
  const [mismatchExpected, setMismatchExpected] = useState<string | null>(null);
  const [mergeToken, setMergeToken] = useState<string | null>(null);
  const [mergeProvider, setMergeProvider] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<AuthIdentity | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: channelKeys.identities() });

  const labelForProvider = (provider: string) => {
    if (provider === "idtrust") return t(($) => $.identities.provider.idtrust);
    if (provider === "github") return t(($) => $.identities.provider.github);
    if (provider === "phone") return t(($) => $.identities.provider.phone);
    return t(($) => $.identities.provider.unknown);
  };

  // Handle post-OAuth bind result from the URL query string. The upstream OAuth
  // callback redirects back here with ?bind=success|conflict|provider_mismatch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bind = params.get("bind");
    if (bind === "success") {
      setBindSuccess(true);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setBindSuccess(false), 5000);
      refresh();
    } else if (bind === "conflict") {
      const token = params.get("merge_token");
      if (token) {
        // Decode the provider name from the JWT payload (first segment). The
        // client only reads the name for display — no signature verification.
        const payload = token.split(".")[0] ?? "";
        try {
          const decoded = JSON.parse(atob(payload));
          setMergeProvider(decoded.provider || "unknown");
        } catch {
          setMergeProvider("unknown");
        }
        setMergeToken(token);
      }
    } else if (bind === "provider_mismatch") {
      setMismatchExpected(params.get("expected_provider"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);

  const handleBind = async (provider: string) => {
    setError(null);
    try {
      const authUrl = await api.startIdentityBind(provider);
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start binding");
    }
  };

  const handleConfirmUnbind = async () => {
    const target = confirmTarget;
    if (!target) return;
    if (visibleIdentities.length <= 1) {
      setError(t(($) => $.identities.errorCannotUnbindLast));
      setConfirmTarget(null);
      return;
    }
    setUnbindingProvider(target.provider);
    setConfirmTarget(null);
    try {
      const result = await api.unbindIdentity(target.provider);
      if (result.requireRelogin) {
        await logout();
        return;
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unbind");
    } finally {
      setUnbindingProvider(null);
    }
  };

  const handleMergeConfirm = async () => {
    if (!mergeToken) return;
    setMerging(true);
    try {
      await api.confirmMerge(mergeToken);
      window.history.replaceState({}, "", window.location.pathname);
      setMergeToken(null);
      setMergeProvider(null);
      setBindSuccess(true);
      setTimeout(() => setBindSuccess(false), 5000);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge accounts");
    } finally {
      setMerging(false);
    }
  };

  const handleMergeCancel = async () => {
    if (mergeToken) {
      try {
        await api.cancelMerge(mergeToken);
      } catch {
        /* ignore — the token may already be invalid */
      }
    }
    window.history.replaceState({}, "", window.location.pathname);
    setMergeToken(null);
    setMergeProvider(null);
  };

  const isLoading = identitiesQ.isLoading;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">{t(($) => $.identities.title)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(($) => $.identities.description)}</p>
        </div>

        {bindSuccess ? (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-500">
            {t(($) => $.identities.bindSuccess)}
          </div>
        ) : null}

        {mismatchExpected ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-500">
            <p className="mb-1 font-medium">{t(($) => $.identities.providerMismatchTitle)}</p>
            <p>{t(($) => $.identities.providerMismatchDescription, { expected: labelForProvider(mismatchExpected) })}</p>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>
              {t(($) => $.identities.dismiss)}
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            ALL_PROVIDERS.map((providerKey) => {
              const identity = identities.find((i) => i.provider === providerKey);
              const isBound = identity !== undefined;
              const color = PROVIDER_COLOR[providerKey];
              return (
                <div
                  key={providerKey}
                  className={
                    "flex items-center justify-between rounded-md border px-4 py-3 transition-colors " +
                    (isBound
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/60 bg-card")
                  }
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-sm text-white"
                      style={{ background: color }}
                    >
                      <ProviderIcon provider={providerKey} />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {labelForProvider(providerKey)}
                    </span>
                  </div>

                  {isBound ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        unbindingProvider === identity?.provider ||
                        visibleIdentities.length <= 1
                      }
                      onClick={() => setConfirmTarget(identity ?? null)}
                      className="shrink-0 px-3 text-sm text-muted-foreground hover:text-destructive"
                      title={
                        visibleIdentities.length <= 1
                          ? t(($) => $.identities.errorCannotUnbindLast)
                          : ""
                      }
                    >
                      {unbindingProvider === identity?.provider ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        t(($) => $.identities.unbind)
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleBind(providerKey)}
                    >
                      {t(($) => $.identities.bind)}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Unbind confirmation */}
      <Dialog open={!!confirmTarget} onOpenChange={(v) => { if (!v) setConfirmTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(($) => $.identities.unbindConfirmTitle)}</DialogTitle>
            <DialogDescription className="pt-2">{t(($) => $.identities.unbindConfirm)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              {tc(($) => $.cancel)}
            </Button>
            <Button variant="destructive" onClick={handleConfirmUnbind}>
              {t(($) => $.identities.unbind)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account-merge modal */}
      <Dialog open={!!mergeToken} onOpenChange={(v) => { if (!v) handleMergeCancel(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(($) => $.identities.mergeTitle)}</DialogTitle>
            <DialogDescription className="pt-2">
              {t(($) => $.identities.mergeDescription, { provider: labelForProvider(mergeProvider ?? "") })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleMergeCancel} disabled={merging}>
              {tc(($) => $.cancel)}
            </Button>
            <Button onClick={handleMergeConfirm} disabled={merging}>
              {merging ? <Loader2 className="size-4 animate-spin" /> : t(($) => $.identities.mergeConfirm)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: ProviderKey }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    );
  }
  if (provider === "phone") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
        <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-4.2-5.78v1.75l3.2-2.99L12.8 9v1.7c-3.11.43-4.35 2.56-4.8 4.7 1.11-1.55 2.69-2.18 4.8-2.18z" />
      </svg>
    );
  }
  // idtrust (default)
  return (
    <svg viewBox="0 0 1228 1024" fill="currentColor" className="size-6">
      <path d="M1045.84 747.027a153.563 153.563 0 0 0-53.156 21.515 129.094 129.094 0 0 1-58.092 35.1c2.953-19.828 12.783-37.926 27.633-51.3a191.186 191.186 0 0 0 26.452-62.142 56.953 56.953 0 1 1 57.164 56.827zM941.639 610.634a190.814 190.814 0 0 0-61.932-26.747 56.953 56.953 0 1 1 56.953-56.953 155.266 155.266 0 0 0 21.263 53.325 129.666 129.666 0 0 1 34.762 58.346 85.978 85.978 0 0 1-50.878-27.97h-0.21z m-93.826-200.728c-17.17-143.817-166.092-256.5-346.274-256.5-191.954 0-348.132 127.744-348.132 284.85a266.33 266.33 0 0 0 124.369 216.169 351.762 351.762 0 0 0 37.969 24.384l-15.44 61.636c5.568 2.616 10.968 5.4 16.663 7.805l77.963-38.981c11.39 2.953 23.372 4.851 35.268 6.876 7.594 1.35 15.188 2.742 22.993 3.67a401.119 401.119 0 0 0 145.547-8.353 281.011 281.011 0 0 0 11.474 62.185 481.153 481.153 0 0 1-108.675 12.698 472.5 472.5 0 0 1-97.621-10.758L262.46 846.21a31.219 31.219 0 0 1-33.877-3.543 31.64 31.64 0 0 1-10.926-32.316l25.312-101.925A330.075 330.075 0 0 1 90.125 438.256c0-192.29 184.19-348.131 411.413-348.131 215.746 0 392.428 140.653 409.64 319.444a276.919 276.919 0 0 0-29.91-2.953c-11.18 0.422-22.36 1.476-33.456 3.248zM716.399 634.47c18.943-3.797 36.957-11.053 53.157-21.515a129.094 129.094 0 0 1 58.134-35.016 86.358 86.358 0 0 1-27.675 51.216c-12.445 18.984-21.389 40.078-26.451 62.184a56.953 56.953 0 1 1-57.165-56.869z m102.6 137.025c18.816 12.614 39.741 21.727 61.763 27a56.953 56.953 0 1 1-56.953 56.953 154.406 154.406 0 0 0-21.094-53.409 129.558 129.558 0 0 1-34.51-58.514 85.888 85.888 0 0 1 50.794 28.308v-0.338z" />
    </svg>
  );
}
