/**
 * MOCK-PURGE-1 — remove every mock/demo row from the live database so the
 * production board is an honest empty slate.
 *
 * Removes:
 *   - deployments with mode = "mock" OR test-prefixed names (TEST*, t4-*)
 *     + all their children (samples, logs, daemon state, events, snapshots,
 *     probes, traffic, benchmarks, revisions)
 *   - GPUHosts with transport = "mock" + their HostChecks
 *   - all AgentNotes (AI analyses of the old demo fleet)
 *   - all AutopilotRules (demo-era rules; mockOnly concept removed from schema)
 *
 * Keeps: AppUsers, AlertChannels (the live webhook), ProviderKeys,
 * ChainSnapshots / SubnetOverrides / ProfitabilitySettings (real config),
 * SubnetRequirements, WorkerStatus, Judge* (lab content), UpstreamState.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const deps = await db.deployment.findMany({
    where: {
      OR: [{ mode: "mock" }, { minerName: { startsWith: "TEST" } }, { minerName: { startsWith: "t4-" } }],
    },
    select: { id: true, minerName: true, mode: true, status: true },
  });
  const depIds = deps.map((d) => d.id);
  console.log("deployments to purge:", deps.length);
  for (const d of deps) console.log("  -", d.minerName, `(${d.mode}, ${d.status})`);

  if (depIds.length > 0) {
    for (const model of [
      "gpuSample",
      "minerLog",
      "probeSample",
      "trafficSample",
      "daemonState",
      "triggerEvent",
      "uidSnapshot",
      "benchmarkRun",
      "deploymentRevision",
    ]) {
      const r = await (db as unknown as Record<string, { deleteMany: (a: object) => Promise<{ count: number }> }>)[
        model
      ].deleteMany({ where: { deploymentId: { in: depIds } } });
      console.log(`  ${model}: -${r.count}`);
    }
    const dr = await db.deployment.deleteMany({ where: { id: { in: depIds } } });
    console.log("  deployment: -" + dr.count);
  }

  const mockHosts = await db.gpuHost.findMany({ where: { transport: "mock" }, select: { id: true, name: true } });
  console.log("mock hosts to purge:", mockHosts.length);
  for (const h of mockHosts) {
    const hc = await db.hostCheck.deleteMany({ where: { hostId: h.id } });
    console.log(`  host "${h.name}": hostChecks -${hc.count}`);
  }
  if (mockHosts.length > 0) {
    const hr = await db.gpuHost.deleteMany({ where: { id: { in: mockHosts.map((h) => h.id) } } });
    console.log("  gpuHost: -" + hr.count);
  }

  const notes = await db.agentNote.deleteMany({});
  console.log("agentNote: -" + notes.count);

  const rules = await db.autopilotRule.deleteMany({});
  console.log("autopilotRule: -" + rules.count);

  console.log("--- post-purge counts ---");
  for (const m of ["deployment", "gpuHost", "gpuSample", "triggerEvent", "daemonState", "uidSnapshot", "agentNote", "alertChannel", "appUser", "autopilotRule"]) {
    console.log(" ", m, await (db as unknown as Record<string, { count: () => Promise<number> }>)[m].count());
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
