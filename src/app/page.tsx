"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardView } from "@/components/views/dashboard-view";
import { OpportunitiesView } from "@/components/views/opportunities-view";
import { SubnetsView } from "@/components/views/subnets-view";
import { GpusView } from "@/components/views/gpus-view";
import { MinersView } from "@/components/views/miners-view";
import { DeploymentsView } from "@/components/views/deployments-view";
import { MonitoringView } from "@/components/views/monitoring-view";
import { AnalyticsView } from "@/components/views/analytics-view";
import { SystemView } from "@/components/views/system-view";
import { OpportunityDetailDialog } from "@/components/cards/opportunity-detail";
import type { Opportunity, ViewKey } from "@/lib/infranex/types";

const VIEW_META: Record<
  ViewKey,
  { title: string; eyebrow: string }
> = {
  dashboard: { title: "Network Intelligence", eyebrow: "Section · 01 · Dashboard" },
  opportunities: { title: "Opportunities", eyebrow: "Section · 02 · Scoring" },
  subnets: { title: "Subnets", eyebrow: "Section · 03 · Chain explorer" },
  gpus: { title: "GPU Catalog", eyebrow: "Section · 04 · Infrastructure" },
  miners: { title: "My Miners", eyebrow: "Section · 05 · Portfolio" },
  deployments: { title: "Deployments", eyebrow: "Section · 06 · Deployment engine" },
  monitoring: { title: "Monitoring", eyebrow: "Section · 07 · Monitoring engine" },
  analytics: { title: "Analytics", eyebrow: "Section · 08 · Trends" },
  system: { title: "System & Errors", eyebrow: "Section · 09 · Diagnostics" },
};

export default function Home() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleSelect = (o: Opportunity) => {
    setSelected(o);
    setDialogOpen(true);
  };

  const meta = VIEW_META[view];

  return (
    <DashboardLayout
      current={view}
      onNavigate={setView}
      title={meta.title}
      eyebrow={meta.eyebrow}
    >
      {view === "dashboard" && (
        <DashboardView onSelectOpportunity={handleSelect} onNavigate={setView} />
      )}
      {view === "opportunities" && (
        <OpportunitiesView onSelectOpportunity={handleSelect} />
      )}
      {view === "subnets" && <SubnetsView />}
      {view === "gpus" && <GpusView />}
      {view === "miners" && <MinersView onNavigate={setView} />}
      {view === "deployments" && <DeploymentsView />}
      {view === "monitoring" && <MonitoringView onNavigate={setView} />}
      {view === "analytics" && <AnalyticsView />}
      {view === "system" && <SystemView onNavigate={setView} />}

      <OpportunityDetailDialog
        opportunity={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </DashboardLayout>
  );
}
