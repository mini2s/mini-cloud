"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useT } from "../../i18n";

/**
 * WeCom Bot binding flow: renders a QR code generated from the backend-provided
 * `botQRCode` URL, plus the three-step binding instructions and a "waiting"
 * indicator. Mirrors the source project's WecomBotBindingFlow. The parent polls
 * the channel list to flip the section to "bound" once webhookVerified is true.
 */
export function WecomBotBindingFlow({ url }: { url: string }) {
  const { t } = useT("channels");
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    QRCode.toDataURL(url, { width: 200, margin: 2 })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => {
        // ignore — the QR simply won't render
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="mt-4 rounded-md bg-amber-500/5 px-4 py-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-4">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt="Bot QR Code"
            style={{ width: 140, height: 140, objectFit: "contain" }}
          />
        ) : null}
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-medium text-foreground">
            {t(($) => $.wecomBot.step1)}
          </div>
          <div className="text-sm text-muted-foreground">
            {t(($) => $.wecomBot.step2)}
          </div>
          <div className="text-sm text-muted-foreground">
            {t(($) => $.wecomBot.step3)}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-500">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
            {t(($) => $.wecomBot.waitingBinding)}
          </div>
        </div>
      </div>
    </div>
  );
}
