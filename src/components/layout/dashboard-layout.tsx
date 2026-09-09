"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { Footer } from "./footer";
import type { ViewKey } from "@/lib/infranex/types";

interface DashboardLayoutProps {
  children: React.ReactNode;
  current: ViewKey;
  onNavigate: (v: ViewKey) => void;
  title: string;
  eyebrow: string;
}

export function DashboardLayout({
  children,
  current,
  onNavigate,
  title,
  eyebrow,
}: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Ambient background — grid + aurora glow, fixed & non-interactive */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute inset-0 grid-pattern gradient-mask-b opacity-60" />
        <div className="absolute -top-40 left-1/4 h-96 w-[560px] rounded-full bg-primary/[0.07] blur-[120px]" />
        <div className="absolute -top-24 right-0 h-80 w-96 rounded-full bg-chart-4/[0.05] blur-[110px]" />
      </div>

      <div className="relative z-10 flex flex-1">
        <Sidebar
          current={current}
          onNavigate={onNavigate}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
        />
        <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
          <Header
            onMenuClick={() => setMobileOpen(true)}
            title={title}
            eyebrow={eyebrow}
          />
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-8" role="main">
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
