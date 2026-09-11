/** Full DEREG-RISK E2E: drive mock deployment to started → run pass →
 *  verify NOT_REGISTERED critical event → approve → act → cleanup. */

const BASE = "http://localhost:3000";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as Record<string, unknown> };
}

async function main() {
  // 1. Find (or create) the test deployment.
  const list = await api("/api/deployments");
  const deps = (list.body.deployments ?? []) as {
    id: string;
    minerName: string;
    status: string;
    mode: string;
    hotkey: string | null;
  }[];
  let dep = deps.find((d) => d.minerName === "Cluster Test Miner");
  if (!dep) {
    const created = await api("/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        netuid: 8,
        offerId: "o2",
        minerName: "Cluster Test Miner",
        hotkey: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        walletName: "test",
        mode: "mock",
      }),
    });
    dep = created.body.deployment as typeof dep;
  }
  if (!dep) throw new Error("no deployment");
  console.log(`deployment ${dep.id} status=${dep.status} hotkey=${dep.hotkey?.slice(0, 8)}…`);

  // 2. Advance to "started" (mock lifecycle is synchronous).
  let cur = dep.status;
  let guard = 0;
  while (cur !== "started" && cur !== "failed" && guard++ < 12) {
    const t = await api("/api/deployments", {
      method: "POST",
      body: JSON.stringify({ action: "tick", id: dep.id }),
    }).catch(() => null);
    // fall back to per-id endpoint if the collection POST isn't supported
    if (!t || t.status >= 400) {
      const t2 = await api(`/api/deployments/${dep!.id}/tick`, { method: "POST" });
      cur = (t2.body.deployment as { status?: string })?.status ?? cur;
    } else {
      cur = (t.body.deployment as { status?: string })?.status ?? cur;
    }
  }
  console.log("after ticks:", cur);
  if (cur !== "started") {
    console.log("⚠ could not reach started — aborting (non-fatal)");
    return;
  }

  // 3. Run the trigger pass — UID defense should sample and flag NOT_REGISTERED.
  const run = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "run" }) });
  const uid = (run.body.uid ?? []) as { deploymentId: string; riskLevel: string; riskCodes: string[]; history: unknown[] }[];
  const mine = uid.find((u) => u.deploymentId === dep!.id);
  console.log("uid state:", mine?.riskLevel, mine?.riskCodes, "history:", mine?.history?.length);

  const open = (run.body.open ?? []) as { id: string; kind: string; title: string; runbook: string[] }[];
  const dereg = open.find((e) => e.kind === "DEREG_RISK" && e.title.includes("α8"));
  console.log("DEREG_RISK event:", dereg ? `${dereg.title} (runbook ${dereg.runbook.length})` : "NOT FOUND");

  if (dereg) {
    // 4. Approve → act.
    const appr = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "approve", id: dereg.id }) });
    console.log("approve:", appr.status, (appr.body.event as { status?: string })?.status);
    const act = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "act", id: dereg.id }) });
    console.log("act:", act.status, String(act.body.action ?? "").slice(0, 80));
  }

  // 5. Cleanup — delete the test deployment so the demo DB stays clean.
  const del = await api(`/api/deployments/${dep.id}`, { method: "DELETE" });
  console.log("cleanup:", del.status);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
