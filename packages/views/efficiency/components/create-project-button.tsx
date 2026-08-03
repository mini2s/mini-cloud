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

export function CreateProjectButton({
  onCreated,
}: {
  onCreated: (projectId: string) => void;
}) {
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
      setError("请输入项目名称");
      return;
    }
    setError("");
    try {
      const result = await mutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      if (!result.project_id) {
        setError("创建项目后未返回项目 ID");
        return;
      }
      setOpen(false);
      onCreated(result.project_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建项目失败");
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" />
        创建项目
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
            <DialogDescription>
              创建后将直接进入该项目的聚焦详情，可继续添加仓库来源。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">项目名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">描述</span>
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
              取消
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
