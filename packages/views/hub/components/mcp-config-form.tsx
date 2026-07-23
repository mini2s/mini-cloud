"use client"

import { useCallback, useMemo, useState, type FormEvent } from "react"
import { Input } from "@multica/ui/components/ui/input"
import { Button } from "@multica/ui/components/ui/button"
import { Eye, EyeOff } from "lucide-react"
import { api } from "@multica/core/api"
import { detectMcpFields, isSecret } from "../lib/mcp-config"
import type { McpField } from "../lib/mcp-config"
import type { CapabilityItem } from "@multica/core/types"

type McpConfigStatus = NonNullable<CapabilityItem["mcpConfig"]>

interface Props {
  itemId: string
  metadata: Record<string, unknown> | null | undefined
  status?: McpConfigStatus
  onSaved: (status: McpConfigStatus) => void
  className?: string
}

export function McpConfigForm(props: Props) {

  const fields = useMemo<McpField[]>(
    () =>
      detectMcpFields(props.metadata, {
        path: "Path",
        arg: (n) => `Argument ${n}`,
      }),
    [props.metadata],
  )

  const statusByKey = useMemo<Record<string, { hasValue: boolean; secret: boolean; value?: string }>>(
    () => Object.fromEntries((props.status?.fields ?? []).map((f) => [f.key, f])),
    [props.status],
  )

  const initialValues = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of fields) {
      out[f.key] = statusByKey[f.key]?.value ?? ""
    }
    return out
  }, [fields, statusByKey])

  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())

  const setValue = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    setDirty((prev) => ({ ...prev, [key]: true }))
    setSaved(false)
  }, [])

  const toggleVisible = useCallback((key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isFilled = useCallback(
    (f: McpField): boolean => {
      const typed = values[f.key]?.trim()
      if (typed) return true
      if (dirty[f.key]) return false
      return Boolean(statusByKey[f.key]?.hasValue)
    },
    [values, dirty, statusByKey],
  )

  const allRequiredFilled = useMemo(
    () => fields.filter((f) => f.required).every(isFilled),
    [fields, isFilled],
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (saving) return
      if (!allRequiredFilled) {
        setError("Please fill in all required fields")
        return
      }

      const payload: Record<string, string> = {}
      for (const f of fields) {
        if (!dirty[f.key]) continue
        payload[f.key] = values[f.key]?.trim() ?? ""
      }

      setError("")
      setSaving(true)
      try {
        await api.hubUpsertMcpConfig(props.itemId, payload)
        setDirty({})
        setSaved(true)
        const newFields = fields.map((f) => ({
          key: f.key,
          hasValue: Boolean(values[f.key]?.trim()),
          secret: f.secret,
          value: values[f.key] ?? "",
        }))
        props.onSaved({ fields: newFields })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [saving, allRequiredFilled, fields, dirty, values, props.itemId, props.onSaved],
  )

  if (fields.length === 0) return null

  return (
    <form onSubmit={handleSubmit} className={["space-y-3", props.className ?? ""].filter(Boolean).join(" ")}>
      <p className="text-xs leading-5 text-muted-foreground">{"Configure the MCP server connection parameters below."}</p>

      {fields.map((field) => {
        const secret = isSecret(field.label, field.placeholder)
        const showSecret = secret && visibleKeys.has(field.key)

        return (
          <div key={field.key} className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <span className="truncate" title={field.label}>
                {field.label}
              </span>
              {field.required && <span className="text-destructive">*</span>}
            </label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : secret ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValue(field.key, e.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
                className="pr-9"
              />
              {secret && (
                <button
                  type="button"
                  onClick={() => toggleVisible(field.key)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || !allRequiredFilled} size="sm">
          {saving ? "Saving..." : "Save"}
        </Button>
        {saved && !saving && (
          <span className="text-xs" style={{ color: "#22c55e" }}>
            {"Saved"}
          </span>
        )}
      </div>
    </form>
  )
}

export default McpConfigForm
