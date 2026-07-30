"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorCog } from "lucide-react";
import type { AgentRuntime, WorkflowRuntimeSelectionPolicy } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@multica/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";

export interface WorkflowRuntimeStrategyValue {
  policy: WorkflowRuntimeSelectionPolicy;
  runtimeId: string | null;
}

interface WorkflowRuntimeStrategyDialogProps {
  mode: "default" | "run";
  workflowTitle: string;
  initialValue: WorkflowRuntimeStrategyValue;
  runtimes: AgentRuntime[];
  loading: boolean;
  directRun?: boolean;
  saving?: boolean;
  getMemberName?: (userId: string) => string;
  onConfirm: (value: WorkflowRuntimeStrategyValue) => void | Promise<void>;
  onClose: () => void;
}

const policyOptions: WorkflowRuntimeSelectionPolicy[] = [
  "specified_runtime_first",
  "idle_first",
  "issue_creator_first",
];

export function WorkflowRuntimeStrategyDialog({
  mode,
  workflowTitle,
  initialValue,
  runtimes,
  loading,
  directRun = false,
  saving = false,
  getMemberName,
  onConfirm,
  onClose,
}: WorkflowRuntimeStrategyDialogProps) {
  const { t } = useT("workflows");
  const [policy, setPolicy] = useState<WorkflowRuntimeSelectionPolicy>(initialValue.policy);
  const [runtimeId, setRuntimeId] = useState(initialValue.runtimeId ?? "");

  useEffect(() => {
    setPolicy(initialValue.policy);
    setRuntimeId(initialValue.runtimeId ?? "");
  }, [initialValue.policy, initialValue.runtimeId]);

  const onlineRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.status === "online"),
    [runtimes],
  );
  const runtimeExists = onlineRuntimes.some((runtime) => runtime.id === runtimeId);
  const selectedRuntime = useMemo(
    () => onlineRuntimes.find((runtime) => runtime.id === runtimeId) ?? null,
    [onlineRuntimes, runtimeId],
  );
  const specifiedRuntimeMissing = policy === "specified_runtime_first" && (!runtimeId || !runtimeExists);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <MonitorCog className="size-4" />
            {mode === "default"
              ? t(($) => $.runtime_strategy.default_title)
              : t(($) => $.runtime_strategy.run_title)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mode === "default"
              ? t(($) => $.runtime_strategy.default_description, { name: workflowTitle })
              : t(($) => $.runtime_strategy.run_description, { name: workflowTitle })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid gap-2">
            {policyOptions.map((option) => (
              <Skeleton key={option} className="h-[70px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup
              className="grid gap-2"
              value={policy}
              onValueChange={(value) => setPolicy(value as WorkflowRuntimeSelectionPolicy)}
            >
              {policyOptions.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent/40 ${
                    policy === option ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <RadioGroupItem value={option} className="mt-0.5 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {t(($) => $.runtime_strategy.policy[option].title)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(($) => $.runtime_strategy.policy[option].description)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>

            {policy === "specified_runtime_first" && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <label className="text-xs font-medium" htmlFor="workflow-runtime-select">
                  {t(($) => $.runtime_strategy.runtime_label)}
                </label>
                <Select
                  value={runtimeExists ? runtimeId : ""}
                  onValueChange={(value) => setRuntimeId(value ?? "")}
                >
                  <SelectTrigger
                    id="workflow-runtime-select"
                    className="h-auto min-h-9 w-full px-3 py-2"
                    size="sm"
                  >
                    <SelectValue
                      className="min-w-0"
                      placeholder={t(
                        ($) => $.runtime_strategy.runtime_placeholder,
                      )}
                    >
                      {selectedRuntime ? (
                        <>
                          <ProviderLogo
                            provider={selectedRuntime.provider}
                            className="size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {selectedRuntime.name}
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-success" />
                            {t(($) => $.runtime_strategy.online)}
                            {selectedRuntime.owner_id && getMemberName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="max-w-28 truncate">
                                  {getMemberName(selectedRuntime.owner_id)}
                                </span>
                              </>
                            )}
                          </span>
                        </>
                      ) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    alignItemWithTrigger={false}
                    className="max-h-64 p-1"
                  >
                    {onlineRuntimes.map((runtime) => (
                      <SelectItem
                        key={runtime.id}
                        value={runtime.id}
                        className="py-2 pr-8 pl-2"
                      >
                        <ProviderLogo
                          provider={runtime.provider}
                          className="size-4 shrink-0"
                        />
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                          <span className="w-full truncate font-medium">
                            {runtime.name}
                          </span>
                          <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-1.5 shrink-0 rounded-full bg-success" />
                            <span>{t(($) => $.runtime_strategy.online)}</span>
                            {runtime.owner_id && getMemberName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">
                                  {getMemberName(runtime.owner_id)}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!runtimeExists && initialValue.runtimeId && (
                  <p className="text-xs text-destructive">
                    {t(($) => $.runtime_strategy.deleted_runtime)}
                  </p>
                )}
                {onlineRuntimes.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(($) => $.runtime_strategy.no_runtime)}
                  </p>
                )}
              </div>
            )}

            {directRun && policy === "issue_creator_first" && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t(($) => $.runtime_strategy.direct_run_hint)}
              </p>
            )}
          </div>
        )}

        <div className="-mx-4 -mb-4 flex items-center justify-end gap-2 border-t bg-background px-5 py-3">
          <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            {t(($) => $.runtime_strategy.cancel)}
          </Button>
          <Button
            size="sm"
            disabled={loading || saving || specifiedRuntimeMissing}
            onClick={() => void onConfirm({
              policy,
              runtimeId: policy === "specified_runtime_first" ? runtimeId : null,
            })}
          >
            {saving
              ? t(($) => $.runtime_strategy.saving)
              : mode === "default"
                ? t(($) => $.runtime_strategy.save_default)
                : t(($) => $.runtime_strategy.start_run)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
