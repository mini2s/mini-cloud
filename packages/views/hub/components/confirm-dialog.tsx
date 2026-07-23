"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog"
import { Button } from "@multica/ui/components/ui/button"
import { useT } from "../../i18n"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  loadingLabel?: string
  variant?: "danger" | "normal"
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useT("hub")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const danger = (props.variant ?? "danger") === "danger"

  async function handle() {
    setLoading(true)
    setError("")
    try {
      await props.onConfirm()
      props.onOpenChange(false)
    } catch (err) {
      setLoading(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!loading && !v) props.onOpenChange(false) }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription className="pt-2">{props.description}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {props.cancelLabel ?? t(($) => $.detail.delete_dialog.cancel)}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            onClick={handle}
            disabled={loading}
          >
            {loading
              ? (props.loadingLabel ?? t(($) => $.detail.delete_dialog.deleting))
              : (props.confirmLabel ?? (danger ? t(($) => $.detail.delete_dialog.confirm) : t(($) => $.dialog.confirm.ok)))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialog
