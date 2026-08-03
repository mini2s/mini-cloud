"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import {
  channelKeys,
  useChannels,
  useUpdateChannelMutation,
  useDeleteChannelMutation,
  useTestChannelMutation,
} from "@multica/core/channels";
import { useQueryClient } from "@tanstack/react-query";
import type { ChannelConfig } from "@multica/core/channels";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../i18n";
import { ConfirmDialog } from "../../hub/components/confirm-dialog";
import { WecomBotBindingFlow } from "./wecom-bot-binding-flow";

export interface TypeDisplay {
  id: string;
  name: string;
  desc: string;
}

interface ChannelTypeSectionProps {
  td: TypeDisplay;
  /** Backend channelType to match (wecom-app maps to backend "wecom"). */
  matchType: string;
  hasIdTrust: boolean;
  onRefresh: () => void;
}

/**
 * One card per notification channel type. Renders the type header with a status
 * badge, enable/disable + test + delete actions, the IDTrust identity gate, and
 * the WeCom-bot QR binding flow. Mirrors the source project's ChannelTypeSection.
 */
export function ChannelTypeSection({
  td,
  matchType,
  hasIdTrust,
  onRefresh,
}: ChannelTypeSectionProps) {
  const { t } = useT("channels");
  const { t: tc } = useT("common");
  const qc = useQueryClient();
  const updateMut = useUpdateChannelMutation();
  const deleteMut = useDeleteChannelMutation();
  const testMut = useTestChannelMutation();

  const { data: allChannels } = useChannels();
  const channels = (allChannels ?? []).filter((ch) => ch.channelType === matchType);
  const first = channels[0];

  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const needsIdTrust = td.id === "wecom-app" || td.id === "wecom-bot";
  const available = !needsIdTrust || hasIdTrust;

  const isWecomBot = td.id === "wecom-bot";
  const isBound = isWecomBot && !!first?.webhookVerified;
  const isBinding = isWecomBot && !!first?.enabled && !first?.webhookVerified;

  // Poll the channel list while waiting for the user's first message so the UI
  // flips to "bound" automatically once the proxy/server handshake completes.
  useEffect(() => {
    if (!isBinding) return;
    const timer = setInterval(() => onRefresh(), 5000);
    return () => clearInterval(timer);
  }, [isBinding, onRefresh]);

  const handleToggle = async () => {
    if (!first) return;
    setToggling(true);
    // Optimistic update: flip enabled in the cache immediately.
    const prev = qc.getQueryData<ChannelConfig[]>(channelKeys.list());
    qc.setQueryData<ChannelConfig[]>(channelKeys.list(), (list) =>
      (list ?? []).map((ch) => (ch.id === first.id ? { ...ch, enabled: !ch.enabled } : ch)),
    );
    try {
      await updateMut.mutateAsync({ id: first.id, input: { enabled: !first.enabled } });
      toast.success(first.enabled ? t(($) => $.toast.disabled) : t(($) => $.toast.enabled));
    } catch (err) {
      // Revert on error.
      qc.setQueryData(channelKeys.list(), prev);
      toast.error(t(($) => $.toast.requestFailed), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setToggling(false);
    }
  };

  const handleTest = async () => {
    if (!first) return;
    setTesting(true);
    try {
      await testMut.mutateAsync(first.id);
      toast.success(t(($) => $.wecomBot.testSent));
    } catch (err) {
      toast.error(t(($) => $.toast.testFailed), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!first) return;
    await deleteMut.mutateAsync(first.id);
    toast.success(t(($) => $.toast.deleted));
  };

  const handleBindIdTrust = async () => {
    try {
      const authUrl = await api.startIdentityBind("idtrust");
      window.location.href = authUrl;
    } catch (err) {
      toast.error(t(($) => $.idtrust.bindFailed), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      {/* Type Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <WeComIcon />
          </div>
          <div>
            <h3 className="m-0 text-base font-semibold tracking-tight text-foreground">
              {td.name}
              <StatusBadge
                channel={first}
                isWecomBot={isWecomBot}
                isBound={isBound}
              />
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{td.desc}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {first?.enabled && isBound ? (
            <Button
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={handleTest}
            >
              {testing ? t(($) => $.testing) : t(($) => $.test)}
            </Button>
          ) : null}
          {first && available ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={toggling}
                onClick={handleToggle}
                className={
                  first.enabled
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-primary"
                }
              >
                {toggling ? t(($) => $.testing) : first.enabled ? t(($) => $.disable) : t(($) => $.enable)}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => setDeleteOpen(true)}
                className="text-destructive hover:bg-destructive/10"
              >
                {tc(($) => $.delete)}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* IDTrust gate — wecom-app / wecom-bot require a bound idtrust identity. */}
      {needsIdTrust && !hasIdTrust ? (
        <div className="mt-4 rounded-md border border-dashed border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
          <div className="text-sm font-medium text-destructive">
            {t(($) => $.idtrust.unavailable.title)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t(($) => $.idtrust.unavailable.description)}
          </div>
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-primary"
              onClick={handleBindIdTrust}
            >
              {t(($) => $.idtrust.bindButton)}
            </Button>
          </div>
        </div>
      ) : null}

      {/* wecom-bot binding / status */}
      {td.id === "wecom-bot" && first?.enabled ? (
        isBound ? (
          <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3">
            <div className="text-sm font-medium text-green-600 dark:text-green-500">
              {t(($) => $.wecomBot.boundHint)}
            </div>
          </div>
        ) : (
          <WecomBotBindingFlow url={first.config?.botQRCode ?? ""} />
        )
      ) : null}

      {/* Not configured */}
      {channels.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border/40 px-4 py-6 text-center text-sm text-muted-foreground">
          {t(($) => $.notConfigured)}
        </div>
      ) : null}

      {/* Per-channel last error */}
      {channels.map((ch) =>
        ch.lastError ? (
          <div key={ch.id} className="py-1 text-xs text-destructive">
            {ch.lastError}
          </div>
        ) : null,
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tc(($) => $.delete)}
        description={t(($) => $.confirmDelete, { name: first?.name ?? "" })}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function StatusBadge({
  channel,
  isWecomBot,
  isBound,
}: {
  channel: ChannelConfig | undefined;
  isWecomBot: boolean;
  isBound: boolean;
}) {
  const { t } = useT("channels");
  if (!channel) return null;
  if (!channel.enabled) {
    return (
      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
        {t(($) => $.disabled)}
      </span>
    );
  }
  if (isWecomBot) {
    if (isBound) {
      return (
        <span className="ml-2 rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-500">
          {t(($) => $.wecomBot.bound)}
        </span>
      );
    }
    return (
      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
        {t(($) => $.wecomBot.unbound)}
      </span>
    );
  }
  return (
    <span className="ml-2 rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-500">
      {t(($) => $.enabled)}
    </span>
  );
}

function WeComIcon() {
  return (
    <svg className="size-6" viewBox="0 0 1228 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M1045.84 747.027a153.563 153.563 0 0 0-53.156 21.515 129.094 129.094 0 0 1-58.092 35.1c2.953-19.828 12.783-37.926 27.633-51.3a191.186 191.186 0 0 0 26.452-62.142 56.953 56.953 0 1 1 57.164 56.827zM941.639 610.634a190.814 190.814 0 0 0-61.932-26.747 56.953 56.953 0 1 1 56.953-56.953 155.266 155.266 0 0 0 21.263 53.325 129.666 129.666 0 0 1 34.762 58.346 85.978 85.978 0 0 1-50.878-27.97h-0.21z m-93.826-200.728c-17.17-143.817-166.092-256.5-346.274-256.5-191.954 0-348.132 127.744-348.132 284.85a266.33 266.33 0 0 0 124.369 216.169 351.762 351.762 0 0 0 37.969 24.384l-15.44 61.636c5.568 2.616 10.968 5.4 16.663 7.805l77.963-38.981c11.39 2.953 23.372 4.851 35.268 6.876 7.594 1.35 15.188 2.742 22.993 3.67a401.119 401.119 0 0 0 145.547-8.353 281.011 281.011 0 0 0 11.474 62.185 481.153 481.153 0 0 1-108.675 12.698 472.5 472.5 0 0 1-97.621-10.758L262.46 846.21a31.219 31.219 0 0 1-33.877-3.543 31.64 31.64 0 0 1-10.926-32.316l25.312-101.925A330.075 330.075 0 0 1 90.125 438.256c0-192.29 184.19-348.131 411.413-348.131 215.746 0 392.428 140.653 409.64 319.444a276.919 276.919 0 0 0-29.91-2.953c-11.18 0.422-22.36 1.476-33.456 3.248zM716.399 634.47c18.943-3.797 36.957-11.053 53.157-21.515a129.094 129.094 0 0 1 58.134-35.016 86.358 86.358 0 0 1-27.675 51.216c-12.445 18.984-21.389 40.078-26.451 62.184a56.953 56.953 0 1 1-57.165-56.869z m102.6 137.025c18.816 12.614 39.741 21.727 61.763 27a56.953 56.953 0 1 1-56.953 56.953 154.406 154.406 0 0 0-21.094-53.409 129.558 129.558 0 0 1-34.51-58.514 85.888 85.888 0 0 1 50.794 28.308v-0.338z"
      />
    </svg>
  );
}
