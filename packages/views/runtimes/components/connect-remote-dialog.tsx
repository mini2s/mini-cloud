"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  Terminal,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { runtimeKeys } from "@multica/core/runtimes/queries";
import { useWSEvent } from "@multica/core/realtime";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";

type Step = "instructions" | "success";

const INSTALL_CMD =
  "npm install -g @costrict/csc --registry=https://registry.npmjs.org/";
const LOGIN_CMD = "csc cloud login";
const START_CMD = "csc cloud start";

export function ConnectRemoteDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("instructions");
  const wsId = useWorkspaceId();
  const slug = useWorkspaceSlug();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const newRuntimeIdRef = useRef<string | null>(null);

  const handleDaemonRegister = useCallback(
    (payload: unknown) => {
      if (step !== "instructions") return;
      qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
      const p = payload as Record<string, unknown> | null;
      if (p?.runtime_id && typeof p.runtime_id === "string") {
        newRuntimeIdRef.current = p.runtime_id;
      }
      setStep("success");
    },
    [step, qc, wsId],
  );
  useWSEvent("daemon:register", handleDaemonRegister);

  const handleGoToAgents = () => {
    onClose();
    if (slug) {
      navigation.push(paths.workspace(slug).agents());
    }
  };

  const handleGoToRuntime = () => {
    onClose();
    if (slug && newRuntimeIdRef.current) {
      navigation.push(
        paths.workspace(slug).runtimeDetail(newRuntimeIdRef.current),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0",
          step === "instructions"
            ? "flex flex-col sm:max-w-[880px]"
            : "sm:max-w-md",
        )}
      >
        {step === "instructions" && <InstructionsStep />}
        {step === "success" && (
          <SuccessStep
            onGoToAgents={handleGoToAgents}
            onGoToRuntime={
              newRuntimeIdRef.current ? handleGoToRuntime : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Copy button + code row
// ---------------------------------------------------------------------------

function CopyButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

function CommandStep({
  step,
  title,
  description,
  cmd,
  copyAria,
}: {
  step: number;
  title: string;
  description: string;
  cmd: string;
  copyAria: string;
}) {
  return (
    <li className="group relative flex gap-3.5 pb-5 last:pb-0">
      <div className="flex shrink-0 flex-col items-center">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
          {step}
        </span>
        <span
          className="mt-2 w-px flex-1 bg-border group-last:hidden"
          aria-hidden
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="pt-0.5 text-sm font-semibold text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-2.5 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pl-3 pr-1.5 font-mono text-[0.8125rem] shadow-xs">
          <Terminal
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 tabular-nums">
            {cmd}
          </code>
          <CopyButton text={cmd} ariaLabel={copyAria} />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Instructions
// ---------------------------------------------------------------------------

function InstructionsStep() {
  const { t } = useT("runtimes");
  return (
    <>
      <div className="grid min-h-0 flex-1 sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <DialogHeader className="relative overflow-hidden border-b bg-muted/35 px-6 pb-5 pt-7 sm:border-b-0 sm:border-r sm:px-7 sm:pb-7">
          <div
            className="pointer-events-none absolute -left-16 -top-20 size-52 rounded-full bg-primary/10 blur-3xl"
            aria-hidden
          />
          <div className="relative">
            <span className="mb-5 flex size-10 items-center justify-center rounded-xl border bg-background text-primary shadow-sm">
              <Terminal className="size-5" aria-hidden />
            </span>
            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-primary">
              {t(($) => $.connect.current_action)}
            </p>
            <DialogTitle className="text-xl font-semibold leading-tight tracking-tight text-balance">
              {t(($) => $.connect.title)}
            </DialogTitle>
            <DialogDescription className="mt-3 text-sm leading-6 text-balance">
              {t(($) => $.connect.description)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-col bg-background">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-7">
            <ol>
              <CommandStep
                step={1}
                title={t(($) => $.connect.install_title)}
                description={t(($) => $.connect.install_description)}
                cmd={INSTALL_CMD}
                copyAria={t(($) => $.connect.copy_aria)}
              />

              <CommandStep
                step={2}
                title={t(($) => $.connect.login_title)}
                description={t(($) => $.connect.login_description)}
                cmd={LOGIN_CMD}
                copyAria={t(($) => $.connect.copy_aria)}
              />

              <CommandStep
                step={3}
                title={t(($) => $.connect.start_title)}
                description={t(($) => $.connect.start_description)}
                cmd={START_CMD}
                copyAria={t(($) => $.connect.copy_aria)}
              />
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Success
// ---------------------------------------------------------------------------

function SuccessStep({
  onGoToAgents,
  onGoToRuntime,
}: {
  onGoToAgents: () => void;
  onGoToRuntime?: () => void;
}) {
  const { t } = useT("runtimes");
  return (
    <>
      <div className="flex flex-col items-center px-7 pb-8 pt-9 text-center">
        <span
          className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success ring-1 ring-success/20"
          aria-hidden
        >
          <CircleCheck className="size-7" />
        </span>
        <DialogHeader className="items-center">
          <DialogTitle className="text-xl font-semibold tracking-tight text-balance">
            {t(($) => $.connect.success_title)}
          </DialogTitle>
          <DialogDescription className="max-w-sm text-sm leading-relaxed text-balance">
            {t(($) => $.connect.success_description)}
          </DialogDescription>
        </DialogHeader>
      </div>

      <DialogFooter className="m-0 rounded-b-xl border-t bg-muted/20 px-5 py-3">
        {onGoToRuntime && (
          <Button variant="ghost" size="sm" onClick={onGoToRuntime}>
            {t(($) => $.connect.view_runtime)}
          </Button>
        )}
        <Button size="sm" onClick={onGoToAgents}>
          {t(($) => $.connect.create_agent)}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DialogFooter>
    </>
  );
}
