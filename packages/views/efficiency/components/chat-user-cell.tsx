// universal_id → resolved display-name cell. Ports the source's ChatUserCell
// (platformShared.tsx), shared by the usage 本部门人员 table and the cost
// members table:
//   1. Roster hit (resolveName returns something other than the raw id) →
//      show "真名(工号)".
//   2. Otherwise fall back to the trimmed chat username.
//   3. Otherwise the first 8 chars of the UUID.
//   4. Otherwise "-".
// A roster load failure leaves resolveName returning the id unchanged, which
// naturally lands in the fallback branch — the table never blocks on it.
//
// The source renders the hit as a Link to /user/:id; per migration design
// decision #2 (no navigation) it's a plain span here — the row click already
// opens the member detail dialog for the same uid.

export function ChatUserCell({
  universalId,
  chatUsername,
  resolveName,
}: {
  universalId: string | null | undefined;
  chatUsername: string | null | undefined;
  resolveName: (userId?: string) => string;
}) {
  const uid = universalId || "";
  const resolved = uid ? resolveName(uid) : "";
  if (uid && resolved && resolved !== uid && resolved !== "-") {
    return (
      <span className="block max-w-[220px] truncate" title={resolved}>
        {resolved}
      </span>
    );
  }
  const fallback =
    (chatUsername || "").trim() || (uid ? `${uid.slice(0, 8)}…` : "");
  if (!fallback) return <span>-</span>;
  return (
    <span className="block max-w-[220px] truncate" title={uid || undefined}>
      {fallback}
    </span>
  );
}
