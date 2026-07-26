// Virtual file-tree model for the capability editor (task 13 / FR-15).
//
// The editor keeps the whole capability bundle in memory as a flat
// `path -> content` map plus a set of explicitly created directories (empty
// dirs cannot be derived from the file map). On publish the map is serialized
// into a zip archive and submitted through the core client `file` payload —
// the same multipart semantics the source store console used
// (hubCreateItem / hubUpdateItem with `file`).

import { zipSync, strToU8 } from "fflate";
import type { CapabilityItem } from "@multica/core/types/hub";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EditorFileMap {
  /** Relative POSIX path -> text content. */
  files: Record<string, string>;
  /** Explicitly created directories (relative POSIX paths, no trailing slash). */
  dirs: Set<string>;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Normalize a user-supplied path: trim, collapse slashes, drop leading "./"
 *  and reject anything escaping the bundle root. Returns "" when invalid. */
export function normalizeRelPath(input: string): string {
  let p = input.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p || p === ".") return "";
  const parts = p.split("/");
  if (parts.some((seg) => !seg || seg === "." || seg === "..")) return "";
  return parts.join("/");
}

export function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function baseNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Join a directory prefix with a child name (`""` dir = bundle root). */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** True when `child` lives under directory `dir` (dir itself excluded). */
export function isUnderDir(child: string, dir: string): boolean {
  return child.startsWith(`${dir}/`);
}

// ── Tree building ──────────────────────────────────────────────────────────

/** Derive the display tree from the flat file map + explicit dirs.
 *  Directories sort before files, then alphabetically; a main file named
 *  `mainFilePath` (e.g. SKILL.md) always floats to the top of its level. */
export function buildFileTree(map: EditorFileMap, mainFilePath?: string): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirIndex = new Map<string, FileTreeNode>();

  const ensureDir = (path: string): FileTreeNode => {
    const cached = dirIndex.get(path);
    if (cached) return cached;
    const name = baseNameOf(path);
    const node: FileTreeNode = { name, path, isDirectory: true, children: [] };
    dirIndex.set(path, node);
    const parent = parentDirOf(path);
    if (parent) ensureDir(parent).children.push(node);
    else root.push(node);
    return node;
  };

  for (const dir of map.dirs) {
    if (dir) ensureDir(dir);
  }

  for (const path of Object.keys(map.files)) {
    const parent = parentDirOf(path);
    const node: FileTreeNode = {
      name: baseNameOf(path),
      path,
      isDirectory: false,
      children: [],
    };
    if (parent) ensureDir(parent).children.push(node);
    else root.push(node);
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (mainFilePath && a.path === mainFilePath) return -1;
      if (mainFilePath && b.path === mainFilePath) return 1;
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.isDirectory) sortNodes(n.children);
    return nodes;
  };

  return sortNodes(root);
}

// ── Map mutations (all return a NEW map — callers hold it in React state) ──

export function emptyFileMap(): EditorFileMap {
  return { files: {}, dirs: new Set() };
}

export function addFile(map: EditorFileMap, path: string, content = ""): EditorFileMap {
  const p = normalizeRelPath(path);
  if (!p || map.files[p] !== undefined) return map;
  const dirs = new Set(map.dirs);
  // Register ancestor dirs so a lone file in a new folder still renders the
  // folder row (the tree derives intermediate dirs anyway — this keeps the
  // explicit-dir set consistent for renames/deletes).
  let d = parentDirOf(p);
  while (d) {
    dirs.add(d);
    d = parentDirOf(d);
  }
  return { files: { ...map.files, [p]: content }, dirs };
}

export function addDir(map: EditorFileMap, path: string): EditorFileMap {
  const p = normalizeRelPath(path);
  if (!p) return map;
  const dirs = new Set(map.dirs);
  let d: string | "" = p;
  while (d) {
    dirs.add(d);
    d = parentDirOf(d);
  }
  return { files: map.files, dirs };
}

export function setFileContent(map: EditorFileMap, path: string, content: string): EditorFileMap {
  if (map.files[path] === undefined) return map;
  return { files: { ...map.files, [path]: content }, dirs: map.dirs };
}

export function deletePath(map: EditorFileMap, path: string): EditorFileMap {
  const files = { ...map.files };
  const dirs = new Set(map.dirs);
  if (files[path] !== undefined) {
    delete files[path];
  }
  // Cascade: deleting a directory removes every descendant file/dir.
  for (const f of Object.keys(files)) {
    if (isUnderDir(f, path)) delete files[f];
  }
  dirs.delete(path);
  for (const d of [...dirs]) {
    if (isUnderDir(d, path)) dirs.delete(d);
  }
  return { files, dirs };
}

export function renamePath(map: EditorFileMap, from: string, to: string): EditorFileMap {
  const target = normalizeRelPath(to);
  if (!target || target === from) return map;
  if (map.files[target] !== undefined || map.dirs.has(target)) return map;

  const files: Record<string, string> = {};
  const dirs = new Set<string>();
  const moveKey = (key: string): string => {
    if (key === from) return target;
    if (isUnderDir(key, from)) return target + key.slice(from.length);
    return key;
  };
  for (const [k, v] of Object.entries(map.files)) files[moveKey(k)] = v;
  for (const d of map.dirs) dirs.add(moveKey(d));
  // Register ancestors of the new location.
  let d = parentDirOf(target);
  while (d) {
    dirs.add(d);
    d = parentDirOf(d);
  }
  return { files, dirs };
}

/** List every file path that would be removed together with `path`
 *  (the path itself included). Used by the delete confirmation. */
export function collectDescendantFiles(map: EditorFileMap, path: string): string[] {
  const out: string[] = [];
  for (const f of Object.keys(map.files)) {
    if (f === path || isUnderDir(f, path)) out.push(f);
  }
  return out.sort();
}

/** First file in stable tree order — used to pick the initial selection. */
export function firstFilePath(map: EditorFileMap, mainFilePath?: string): string | null {
  if (mainFilePath && map.files[mainFilePath] !== undefined) return mainFilePath;
  const keys = Object.keys(map.files).sort();
  return keys[0] ?? null;
}

// ── Dirty tracking ─────────────────────────────────────────────────────────

/** Deep-compare two file maps (files + explicit dirs). */
export function fileMapsEqual(a: EditorFileMap, b: EditorFileMap): boolean {
  const ak = Object.keys(a.files);
  const bk = Object.keys(b.files);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (b.files[k] !== a.files[k]) return false;
  }
  if (a.dirs.size !== b.dirs.size) return false;
  for (const d of a.dirs) if (!b.dirs.has(d)) return false;
  return true;
}

// ── Default templates ──────────────────────────────────────────────────────

/** Main entry file name per capability type (mirrors the discovery
 *  conventions used across the platform: SKILL.md for skills, etc.). */
export const MAIN_FILE_BY_TYPE: Record<string, string> = {
  skill: "SKILL.md",
  subagent: "AGENT.md",
  command: "COMMAND.md",
  mcp: "mcp.json",
  plugin: "plugin.json",
};

export function mainFileForType(itemType: string): string {
  return MAIN_FILE_BY_TYPE[itemType] ?? "README.md";
}

function defaultTemplate(itemType: string, name: string): string {
  switch (itemType) {
    case "skill":
      return `---\nname: ${name || "my-skill"}\ndescription: ""\n---\n\n# ${name || "My Skill"}\n\n`;
    case "subagent":
      return `---\nname: ${name || "my-agent"}\ndescription: ""\n---\n\n# ${name || "My Agent"}\n\n`;
    case "command":
      return `# ${name || "my-command"}\n\n`;
    case "mcp":
      return JSON.stringify({ mcpServers: {} }, null, 2) + "\n";
    case "plugin":
      return JSON.stringify({ name: name || "my-plugin", version: "0.1.0" }, null, 2) + "\n";
    default:
      return "";
  }
}

/** Initial file map for the create flow: a single main file with a
 *  type-appropriate template. */
export function initialFileMapForCreate(itemType: string, name: string): EditorFileMap {
  const main = mainFileForType(itemType);
  return addFile(emptyFileMap(), main, defaultTemplate(itemType, name));
}

/**
 * Rebuild the file map when editing an existing item:
 *  - `item.content` is the main file body, placed at `item.sourcePath` when
 *    the backend provides one, else at the type-conventional main file name;
 *  - every `assets[]` entry becomes an additional file (`relPath` +
 *    `textContent`), skipping entries that collide with the main file path.
 * Returns the map plus the resolved main file path.
 */
export function fileMapFromItem(item: CapabilityItem): { map: EditorFileMap; mainFile: string } {
  const mainFile = normalizeRelPath(item.sourcePath ?? "") || mainFileForType(item.itemType);
  let map = addFile(emptyFileMap(), mainFile, item.content ?? "");
  for (const asset of item.assets ?? []) {
    const p = normalizeRelPath(asset.relPath ?? "");
    if (!p || p === mainFile) continue;
    if (typeof asset.textContent !== "string") continue;
    map = addFile(map, p, asset.textContent);
  }
  return { map, mainFile };
}

// ── Zip serialization (publish payload) ────────────────────────────────────

/** Serialize the file map into a zip archive (store-only, no compression
 *  ratio requirements — text bundles are tiny). Empty directories are not
 *  representable as items, matching regular capability bundle semantics. */
export function fileMapToZip(map: EditorFileMap): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(map.files)) {
    entries[path] = strToU8(content);
  }
  return zipSync(entries, { level: 0 });
}

/** Wrap the zip bytes as a `File` for the client multipart payload. */
export function fileMapToZipFile(map: EditorFileMap, archiveName: string): File {
  const bytes = fileMapToZip(map);
  const safe = archiveName.trim().replace(/[^\w.-]+/g, "-") || "capability";
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new File([buf], `${safe}.zip`, { type: "application/zip" });
}

// ── Misc ───────────────────────────────────────────────────────────────────

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_RE.test(path);
}
