"use client";

import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { DashboardGuard } from "@multica/views/layout";
import { WorkspacePresencePrefetch } from "@multica/views/layout";
import { ModalRegistry } from "@multica/views/modals/registry";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { AdminSidebar } from "@/components/layout/admin-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="flex h-svh items-center justify-center">
          <MulticaIcon className="size-6 animate-pulse" />
        </div>
      }
    >
      <SidebarProvider className="h-svh">
        <WorkspacePresencePrefetch />
        <AdminSidebar />
        <SidebarInset className="relative overflow-hidden">
          {children}
          <ModalRegistry />
        </SidebarInset>
      </SidebarProvider>
    </DashboardGuard>
  );
}
