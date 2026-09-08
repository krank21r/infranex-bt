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
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">
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
          <main className="flex-1 p-4 lg:p-8" role="main">
            {children}
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
