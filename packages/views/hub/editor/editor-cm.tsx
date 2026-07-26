"use client"

// CodeMirror 6 wrapper for the capability editor (task 13 / FR-15).
//
// - Language pack picked by file extension (markdown/json/yaml/js/ts/python/
//   html/css); unknown extensions fall back to plain text.
// - Theme follows the app-wide `.dark` class on <html> via a Compartment +
//   MutationObserver (same approach as the source console editor), so the
//   editor flips with the site theme without a remount.
// - History / default & search keymaps / indent-with-tab are always on.
// - Switching files rebuilds the editor state (fresh undo history per file),
//   while doc changes made inside the editor flow up through `onChange`
//   without ever resetting the state.

import { useEffect, useRef } from "react"
import { EditorState, Compartment, type Extension } from "@codemirror/state"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageSupport,
} from "@codemirror/language"
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { oneDark } from "@codemirror/theme-one-dark"
import { markdown } from "@codemirror/lang-markdown"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"

// ── Language resolution ────────────────────────────────────────────────────

function languageFor(path: string): LanguageSupport | null {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return null
  const ext = path.slice(dot + 1).toLowerCase()
  switch (ext) {
    case "md":
    case "mdx":
    case "markdown":
      return markdown()
    case "json":
      return json()
    case "yaml":
    case "yml":
      return yaml()
    case "js":
    case "mjs":
    case "cjs":
      return javascript()
    case "jsx":
      return javascript({ jsx: true })
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true })
    case "tsx":
      return javascript({ typescript: true, jsx: true })
    case "py":
      return python()
    case "html":
    case "htm":
      return html()
    case "css":
      return css()
    default:
      return null
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
}

/** Base theme pinned to the design-token system: transparent background so
 *  the editor sits on the page surface, monospace stack from the token
 *  cascade, full-height scroller. */
const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "12px 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--accent)",
  },
})

export interface EditorCmProps {
  /** Current file path — drives the language pack. */
  path: string
  /** Controlled document content. */
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export function EditorCm({ path, value, onChange, readOnly = false }: EditorCmProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  if (!themeCompartmentRef.current) themeCompartmentRef.current = new Compartment()

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  /** Last doc emitted upward by the editor itself — lets the sync effect
   *  distinguish its own keystrokes from external value swaps. */
  const emittedRef = useRef<string>(value)
  const lastPathRef = useRef<string>(path)
  const buildStateRef = useRef<((p: string, d: string) => EditorState) | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const themeCompartment = themeCompartmentRef.current!

    const buildState = (docPath: string, doc: string) => {
      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        baseTheme,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        themeCompartment.of(isDarkMode() ? oneDark : []),
        EditorState.readOnly.of(readOnlyRef.current),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString()
            emittedRef.current = next
            onChangeRef.current(next)
          }
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
      ]
      const lang = languageFor(docPath)
      if (lang) extensions.push(lang)
      return EditorState.create({ doc, extensions })
    }

    const view = new EditorView({
      state: buildState(lastPathRef.current, emittedRef.current),
      parent: containerRef.current,
    })
    viewRef.current = view

    // Follow the `.dark` class toggle on <html>.
    const observer = new MutationObserver(() => {
      view.dispatch({
        effects: themeCompartment.reconfigure(isDarkMode() ? oneDark : []),
      })
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    // Expose the state builder to the sync effect below.
    buildStateRef.current = buildState

    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
      buildStateRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external changes: file switch (path) or external value replacement
  // rebuilds the state (fresh history); the editor's own keystrokes short-
  // circuit through `emittedRef`.
  useEffect(() => {
    const view = viewRef.current
    const buildState = buildStateRef.current
    if (!view || !buildState) return
    const currentDoc = view.state.doc.toString()
    const docChanged = value !== currentDoc
    const pathChanged = path !== lastPathRef.current
    if (!docChanged && !pathChanged) return
    lastPathRef.current = path
    view.setState(buildState(path, value))
    emittedRef.current = value
  }, [path, value])

  return <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />
}
