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
import { Label } from "@multica/ui/components/ui/label"
import { Textarea } from "@multica/ui/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@multica/ui/components/ui/command"
import { Badge } from "@multica/ui/components/ui/badge"
import { Button as IconButton } from "@multica/ui/components/ui/button"
import { api } from "@multica/core/api"
import type { CapabilityItem, EnterpriseCustomer } from "@multica/core/types/hub"
import { useT } from "@multica/views/i18n"
import { toast } from "sonner"
import { Building2, Send, X, Check, ChevronsUpDown } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

const PERMISSION_OPTS = [
  { value: "readonly", label: "hub.distribute.permission.readonly" },
  { value: "dismissible", label: "hub.distribute.permission.dismissible" },
] as const

export type DistributeDialogProps = {
  item: CapabilityItem
  onCreated: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DistributeDialog(props: DistributeDialogProps) {
  const { t } = useT("hub")
  const [submitting, setSubmitting] = useState(false)
  const [permMode, setPermMode] = useState("readonly")
  const [selected, setSelected] = useState<EnterpriseCustomer[]>([])
  const [message, setMsg] = useState("")
  const [open, setOpen] = useState(false)

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["hub", "enterprise-customers"],
    queryFn: () => api.hubListEnterpriseCustomers(),
  })

  function toggleCustomer(c: EnterpriseCustomer) {
    setSelected((prev) =>
      prev.some((x) => x.id === c.id)
        ? prev.filter((x) => x.id !== c.id)
        : [...prev, c],
    )
  }

  async function handle() {
    if (selected.length === 0) {
      toast.error(t(($) => $.dialog.distribute.error_no_target))
      return
    }
    setSubmitting(true)
    try {
      const targets = selected.map((c) => ({
        scopeType: "department" as const,
        targetId: c.id,
      }))
      await api.hubDistributeItem(props.item.id, {
        targets,
        permissionMode: permMode as "readonly" | "dismissible",
        message: message.trim() || undefined,
      })
      toast.success(t(($) => $.dialog.distribute.success))
      props.onCreated()
      props.onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t(($) => $.dialog.distribute.error_failed), { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!submitting) props.onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" />
            {t(($) => $.dialog.distribute.title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.dialog.distribute.subtitle, { name: props.item.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* Enterprise customer selector */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.dialog.distribute.target_label)}</Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                  />
                }
              >
                <div className="flex items-center gap-2 truncate">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  {selected.length > 0
                    ? selected.map((c) => c.name).join(", ")
                    : t(($) => $.dialog.distribute.target_placeholder)}
                </div>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder={t(($) => $.dialog.distribute.search_placeholder)} />
                  <CommandList>
                    <CommandEmpty>{t(($) => $.dialog.distribute.target_empty)}</CommandEmpty>
                    <CommandGroup>
                      {customers.map((c) => {
                        const active = selected.some((x) => x.id === c.id)
                        return (
                          <CommandItem key={c.id} value={c.name} onSelect={() => toggleCustomer(c)}>
                            <div className="flex items-center gap-2 flex-1">
                              <Building2 className="size-4 text-muted-foreground" />
                              <span>{c.name}</span>
                            </div>
                            {active && <Check className="ml-2 size-4" />}
                          </CommandItem>
                        )
                      })}
                      {!loadingCustomers && customers.length === 0 && (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          {t(($) => $.dialog.distribute.no_customers)}
                        </div>
                      )}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selected.map((c) => (
                  <Badge key={c.id} variant="secondary" className="gap-1">
                    <Building2 className="size-3" />
                    {c.name}
                    <IconButton
                      variant="ghost"
                      size="icon"
                      className="ml-0.5 size-4 p-0 hover:bg-transparent"
                      onClick={() => toggleCustomer(c)}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Permission mode */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.dialog.distribute.permission_label)}</Label>
            <Select value={permMode} onValueChange={(v) => setPermMode(v ?? "")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_OPTS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.label as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label>{t(($) => $.dialog.distribute.message_label)}</Label>
            <Textarea
              value={message}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={t(($) => $.dialog.distribute.message_placeholder)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={submitting}
          >
            {t(($) => $.dialog.cancel)}
          </Button>
          <Button
            onClick={handle}
            disabled={submitting || selected.length === 0}
          >
            {submitting
              ? t(($) => $.dialog.distribute.submitting)
              : t(($) => $.dialog.distribute.submit)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

