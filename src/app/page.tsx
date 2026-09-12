"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardView } from "@/components/views/dashboard-view";
import { OpportunitiesView } from "@/components/views/opportunities-view";
import { SubnetsView } from "@/components/views/subnets-view";
import { JudgeView } from "@/components/views/judge-view";
import { GpusView } from "@/components/views/gpus-view";
import { MinersView } from "@/components/views/miners-view";
import { DeploymentsView } from "@/components/views/deployments-view";
import { MonitoringView } from "@/components/views/monitoring-view";
import { OptimizationView } from "@/components/views/optimization-view";
import { AnalyticsView } from "@/components/views/analytics-view";
import { SystemView } from "@/components/views/system-view";
import { OpportunityDetailDialog } from "@/components/cards/opportunity-detail";
import {
  DeployWizard,
  type OpenDeployWizardOptions,
} from "@/components/deployments/deploy-wizard";
import { loadJourney } from "@/components/devops/mining-journey";
import type { Opportunity, ViewKey } from "@/lib/infranex/types";

const VIEW_META: Record<
  ViewKey,
  { title: string; eyebrow: string }
> = {
  dashboard: { title: "Network Intelligence", eyebrow: "Section · 01 · Dashboard" },
  opportunities: { title: "Opportunities", eyebrow: "Section · 02 · Scoring" },
  subnets: { title: "Subnets", eyebrow: "Section · 03 · Chain explorer" },
  judge: { title: "Judge Lab", eyebrow: "Section · 11 · Judge intelligence" },
  gpus: { title: "GPU Catalog", eyebrow: "Section · 04 · Infrastructure" },
  miners: { title: "My Miners", eyebrow: "Section · 05 · Portfolio" },
  deployments: { title: "Deployments", eyebrow: "Section · 06 · Deployment engine" },
  monitoring: { title: "Monitoring", eyebrow: "Section · 07 · Monitoring engine" },
  optimization: { title: "Optimization", eyebrow: "Section · 08 · Optimization engine" },
  analytics: { title: "Analytics", eyebrow: "Section · 09 · Trends" },
  system: { title: "System & Errors", eyebrow: "Section · 10 · Diagnostics" },
};

export default function Home() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // FLOW-1 — ONE guided deploy wizard at the app root. Every entry point
  // (opportunity "Start mining", GPU catalog "Provision", deployments view,
  // mining journey "Rent a GPU") opens THIS instance with its context
  // preselected, so the whole platform follows one linear flow:
  //   choose subnet → check required GPU → buy the GPU → install (auto)
  //   → add hotkey & run (registration LAST).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardNetuid, setWizardNetuid] = useState<number | null>(null);
  const [wizardOfferId, setWizardOfferId] = useState<string | null>(null);
  const [createdDepId, setCreatedDepId] = useState<string | null>(null);

  const openDeployWizard = (opts?: OpenDeployWizardOptions) => {
    // No explicit subnet → fall back to the mining journey's pick so the
    // GPU catalog and journey CTAs continue the already-started story.
    const journeyNetuid = opts?.netuid === undefined ? loadJourney()?.netuid ?? null : opts.netuid;
    setWizardNetuid(journeyNetuid);
    setWizardOfferId(opts?.offerId ?? null);
    setWizardOpen(true);
  };

  const handleSelect = (o: Opportunity) => {
    setSelected(o);
    setDialogOpen(true);
  };

  // "Start mining" on an opportunity: land on Deployments AND open the
  // wizard with that subnet preselected — the user continues at step 2
  // (check required GPU) instead of re-picking the subnet.
  const handleStartMining = (o: Opportunity) => {
    setView("deployments");
    openDeployWizard({ netuid: o.netuid });
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
        <DashboardView
          onSelectOpportunity={handleSelect}
          onStartMining={handleStartMining}
          onNavigate={setView}
        />
      )}
      {view === "opportunities" && (
        <OpportunitiesView
          onSelectOpportunity={handleSelect}
          onStartMining={handleStartMining}
        />
      )}
      {view === "subnets" && <SubnetsView />}
      {view === "judge" && <JudgeView />}
      {view === "gpus" && (
        <GpusView
          onProvision={(offerId) => openDeployWizard({ offerId })}
        />
      )}
      {view === "miners" && <MinersView onNavigate={setView} />}
      {view === "deployments" && (
        <DeploymentsView
          onOpenWizard={openDeployWizard}
          focusDeploymentId={createdDepId}
        />
      )}
      {view === "monitoring" && <MonitoringView onNavigate={setView} />}
      {view === "optimization" && <OptimizationView onNavigate={setView} />}
      {view === "analytics" && <AnalyticsView />}
      {view === "system" && <SystemView onNavigate={setView} />}

      <OpportunityDetailDialog
        opportunity={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {/* The single guided deploy flow — shared by every entry point. */}
      <DeployWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialNetuid={wizardNetuid}
        initialOfferId={wizardOfferId}
        onCreated={setCreatedDepId}
      />
    </DashboardLayout>
  );
}
