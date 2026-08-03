"use client";

import { useChannels, useAvailableChannelTypes, useIdentities } from "@multica/core/channels";
import type { ChannelType } from "@multica/core/channels";
import { useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "@multica/core/channels";
import { useT } from "../../i18n";
import { ChannelTypeSection, type TypeDisplay } from "./channel-type-section";

// Backend channel-type → display id map. "wecom" (the app variant) maps to a
// "wecom-app" display; "wecom-bot" keeps its id. Other types render generically.
const TYPE_DISPLAY_ID: Record<string, string> = {
  wecom: "wecom-app",
};

export function ChannelsPage() {
  const { t } = useT("channels");
  const qc = useQueryClient();

  const channelsQ = useChannels();
  const typesQ = useAvailableChannelTypes();
  const identitiesQ = useIdentities();

  const hasIdTrust = (identitiesQ.data ?? []).some((i) => i.provider === "idtrust");
  const isLoading = typesQ.isLoading || channelsQ.isLoading;

  const typeDisplays: TypeDisplay[] = (typesQ.data ?? []).map((type: ChannelType) => {
    const id = TYPE_DISPLAY_ID[type.type] ?? type.type;
    // Known types resolve to an i18n string via a static selector; unknown
    // types fall back to the raw backend type string.
    const name = type.type === "wecom-bot"
      ? t(($) => $.type["wecom-bot"])
      : type.type;
    return { id, name, desc: "" };
  });

  const refreshChannels = () => qc.invalidateQueries({ queryKey: channelKeys.list() });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto p-4 md:p-6 space-y-6">
          <div>
            <h1 className="text-lg font-semibold">{t(($) => $.title)}</h1>
            <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
              {t(($) => $.description)}
            </p>
          </div>

          {isLoading ? (
            <div className="rounded-lg border border-dashed border-border/40 px-6 py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.loading)}
            </div>
          ) : typeDisplays.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 px-6 py-8 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="font-medium text-foreground">
                  {t(($) => $.noChannels.title)}
                </div>
                <div className="text-muted-foreground">
                  {t(($) => $.noChannels.description)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {typeDisplays.map((td) => (
                <ChannelTypeSection
                  key={td.id}
                  td={td}
                  matchType={td.id === "wecom-app" ? "wecom" : td.id}
                  hasIdTrust={hasIdTrust}
                  onRefresh={refreshChannels}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
