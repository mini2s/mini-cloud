"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useCreateProject } from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../../i18n";

export function CreateProjectButton({
  onCreated,
}: {
  onCreated: (projectId: string) => void;
}) {
  const { t } = useT("efficiency");
  const mutation = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setError("");
    }
  }, [open]);

  async function submit() {
    if (!name.trim()) {
      setError(t(($) => $.common.project_create.name_required));
      return;
    }
    setError("");
    try {
      const result = await mutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      if (!result.project_id) {
        setError(t(($) => $.common.project_create.missing_id));
        return;
      }
      setOpen(false);
      onCreated(result.project_id);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? t(($) => $.common.project_create.failed_detail, {
              detail: cause.message,
            })
          : t(($) => $.common.project_create.failed),
      );
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" />
        {t(($) => $.common.project_create.button)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(($) => $.common.project_create.title)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.common.project_create.description)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                {t(($) => $.common.project_create.name)}
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                {t(($) => $.common.project_create.description_label)}
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t(($) => $.common.project_create.cancel)}
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending
                ? t(($) => $.common.project_create.submitting)
                : t(($) => $.common.project_create.submit)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
