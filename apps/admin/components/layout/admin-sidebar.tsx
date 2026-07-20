"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AppLink } from "@multica/views/navigation";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useAuthStore } from "@multica/core/auth";
import { useLogout } from "@multica/views/auth";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@multica/ui/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@multica/ui/components/ui/collapsible";
import { HOME_NAV, NAV_GROUPS, type NavGroup } from "./sidebar-config";

// Per-group default open state. Groups the operator lives in day-to-day
// (workbench, projects, collaboration, repository) start expanded; the
// heavier admin / metrics / me groups stay collapsed until opened.
const DEFAULT_OPEN: Record<string, boolean> = {
  workbench: true,
  projects: true,
  collaboration: true,
  repository: true,
  metrics: false,
  admin: false,
  me: false,
};

/**
 * Active-link predicate.
 *
 * Home (href === "") is active only at the workspace root — pathname with
 * ≤1 non-empty segment (e.g. "/my-team" or "/my-team/"). Anything deeper
 * ("/my-team/issues") is NOT home.
 *
 * All other items follow the standard shadcn rule: active when pathname
 * equals href OR is a descendant of it.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "") {
    const segments = pathname.split("/").filter(Boolean);
    return segments.length <= 1;
  }
  return pathname === href || pathname.startsWith(href + "/");
}

function initialsFor(name: string | null | undefined): string {
  return (name ?? "U").charAt(0).toUpperCase();
}

function GroupBlock({
  group,
  baseHref,
  pathname,
}: {
  group: NavGroup;
  baseHref: string;
  pathname: string;
}) {
  const [open, setOpen] = useState(DEFAULT_OPEN[group.id] ?? true);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarGroup>
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger className="flex w-full items-center justify-between" />
          }
        >
          <span>{group.labelZh}</span>
          <ChevronRight className="size-3 transition-transform group-data-[panel-open]/collapsible:rotate-90" />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const href = `${baseHref}${item.href}`;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(pathname, href)}
                      render={<AppLink href={href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.labelZh}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const workspace = useCurrentWorkspace();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  // useCurrentWorkspace() returns Workspace | null. When the provider hasn't
  // populated a slug yet (or we're rendering outside a workspace route),
  // links resolve against "/" so they still work as plain top-level routes.
  const baseHref = workspace?.slug ? `/${workspace.slug}` : "";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <MulticaIcon className="size-6" />
          <span className="text-sm font-semibold">Multica Admin</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive(pathname, "")}
                  render={<AppLink href={`${baseHref}/`} />}
                >
                  <HOME_NAV.icon className="size-4" />
                  <span>{HOME_NAV.labelZh}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {NAV_GROUPS.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            baseHref={baseHref}
            pathname={pathname}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled={!user} onClick={() => void logout()}>
              <ActorAvatar
                name={user?.name ?? ""}
                initials={initialsFor(user?.name)}
                avatarUrl={user?.avatar_url}
                size={16}
                className="!size-4"
              />
              <span>{user?.name ?? "…"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
