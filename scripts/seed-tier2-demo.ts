// Seed a demo revision chain on monitor-demo-01 so the browser demo shows a
// live rollback: r1 = current config (deploy backfill), then mutate one env
// var and snapshot r2 (drift) — leaving live == r2 and r1 one rollback away.
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ID = "cmtskn4ne0000rro1z0rfvq95"; // monitor-demo-01 (mock, started)

async function main() {
  const dep = await db.deployment.findUnique({ where: { id: ID } });
  if (!dep) throw new Error("mock deployment missing");
  await db.deploymentRevision.deleteMany({ where: { deploymentId: ID } });

  const { snapshotRevision } = await import("../src/lib/infranex/deployment/revisions");
  const r1 = await snapshotRevision(ID, "deploy", "initial deploy config (backfilled for demo)", "ops01");
  console.log("r1", r1);

  const cfg = JSON.parse(dep.config);
  cfg.docker.envVars = [
    ...(Array.isArray(cfg.docker.envVars) ? cfg.docker.envVars.filter((e: { name: string }) => e.name !== "INFANEX_TENSORRT_PAD") : []),
    { name: "INFANEX_TENSORRT_PAD", value: "true", secret: false },
  ];
  await db.deployment.update({
    where: { id: ID },
    data: { config: JSON.stringify(cfg) },
  });
  const r2 = await snapshotRevision(ID, "runtime-opt", "before runtime optimization: TensorRT-LLM profiling pad", "engine");
  console.log("r2", r2);

  const list = await db.deploymentRevision.findMany({ where: { deploymentId: ID }, orderBy: { rev: "asc" } });
  console.log("chain:", list.map((r) => `r${r.rev}:${r.cause}`).join(" "));
}
main().finally(() => db.$disconnect());
