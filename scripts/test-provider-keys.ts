/**
 * Provider API Keys — end-to-end test against a running dev server.
 *
 * Usage: BASE=http://localhost:3000 bunx tsx scripts/test-provider-keys.ts
 * (needs `bun run dev` up; tolerates offline provider APIs — a rejected or
 * unreachable provider both surface as non-"valid" statuses, which is what
 * these assertions check).
 */
import dotenv from "dotenv";
dotenv.config({ override: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
const FAKE = {
  runpod: `fake-runpod-${Date.now().toString(36)}-x9`,
  vast: `fake-vast-${Date.now().toString(36)}-k2`,
  lambda: `fake-lambda-${Date.now().toString(36)}-q7`,
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`PASS — ${name}`);
  } else {
    fail++;
    console.log(`FAIL — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  // --- 1. GET lists all four providers -----------------------------------
  let r = await api("GET", "/api/providers/keys");
  check("GET keys 200", r.status === 200);
  const keys = (r.json?.keys ?? []) as Array<Record<string, unknown>>;
  check("GET lists 4 providers", keys.length === 4, `got ${keys.length}`);
  const ids = keys.map((k) => k.id);
  check(
    "provider ids complete",
    ["runpod", "vast", "lambda", "nvidia"].every((id) => ids.includes(id))
  );
  const nvidia = keys.find((k) => k.id === "nvidia");
  check("nvidia is catalog-only", nvidia?.offers === false && nvidia?.rent === false);

  // --- 2. input validation ------------------------------------------------
  r = await api("PUT", "/api/providers/keys", { provider: "amazon", key: "whatever12345" });
  check("PUT unknown provider → 400", r.status === 400);
  r = await api("PUT", "/api/providers/keys", { provider: "runpod", key: "short" });
  check("PUT short key → 400", r.status === 400);
  r = await api("PUT", "/api/providers/keys", { provider: "runpod", key: "has spaces inside" });
  check("PUT whitespace key → 400", r.status === 400);
  r = await api("PUT", "/api/providers/keys", { provider: "nvidia", key: "nvidia-key-12345" });
  check("PUT nvidia (no API) → 400", r.status === 400);

  // --- 3. save fake keys → verdict + masked, never plaintext --------------
  for (const provider of ["runpod", "vast", "lambda"] as const) {
    r = await api("PUT", "/api/providers/keys", { provider, key: FAKE[provider] });
    check(`PUT ${provider} fake key → 200`, r.status === 200);
    const entry = r.json?.key as Record<string, unknown> | undefined;
    const checkResult = r.json?.check as { status?: string } | undefined;
    check(
      `PUT ${provider} returns verdict in {invalid,error}`,
      checkResult?.status === "invalid" || checkResult?.status === "error",
      `got ${checkResult?.status}`
    );
    check(
      `PUT ${provider} stores non-valid status`,
      entry?.status === checkResult?.status
    );
    const masked = String(entry?.maskedKey ?? "");
    check(`PUT ${provider} masked key shape`, masked.includes("\u2026") && masked !== FAKE[provider], masked);
  }

  // --- 4. GET never leaks the plaintext -----------------------------------
  r = await api("GET", "/api/providers/keys");
  const raw = JSON.stringify(r.json);
  for (const provider of ["runpod", "vast", "lambda"] as const) {
    check(`GET hides ${provider} plaintext`, !raw.includes(FAKE[provider]));
  }
  const runpodEntry = (r.json?.keys ?? []).find((k: Record<string, unknown>) => k.id === "runpod") as Record<string, unknown>;
  check("GET runpod hasKey=true", runpodEntry?.hasKey === true);
  check("GET runpod lastCheckedAt set", typeof runpodEntry?.lastCheckedAt === "string");

  // --- 5. explicit re-test endpoint ----------------------------------------
  r = await api("POST", "/api/providers/keys/test", { provider: "runpod" });
  check("POST test 200 with verdict", r.status === 200 && typeof r.json?.check?.status === "string");
  r = await api("POST", "/api/providers/keys/test", { provider: "nvidia" });
  check("POST test nvidia → 404 (no key possible)", r.status === 404);

  // --- 6. DELETE removes and falls back ------------------------------------
  r = await api("DELETE", "/api/providers/keys?provider=vast");
  check("DELETE vast → ok", r.status === 200);
  r = await api("GET", "/api/providers/keys");
  const vastAfter = (r.json?.keys ?? []).find((k: Record<string, unknown>) => k.id === "vast") as Record<string, unknown>;
  check("GET vast hasKey=false after delete", vastAfter?.hasKey === false);

  // --- 7. gpu-offers snapshot is multi-provider ----------------------------
  r = await api("GET", "/api/gpu-offers");
  check("gpu-offers 200", r.status === 200);
  check("gpu-offers has providers array", Array.isArray(r.json?.providers));
  const snapProviders = (r.json?.providers ?? []) as Array<Record<string, unknown>>;
  check(
    "snapshot providers are the offer-capable three",
    snapProviders.length === 3 && ["runpod", "vast", "lambda"].every((id) => snapProviders.some((p) => p.id === id))
  );
  check("snapshot has offers + source", Array.isArray(r.json?.offers) && typeof r.json?.source === "string");

  // --- 8. cleanup -----------------------------------------------------------
  for (const provider of ["runpod", "lambda"] as const) {
    await api("DELETE", `/api/providers/keys?provider=${provider}`);
  }
  r = await api("GET", "/api/providers/keys");
  const leftovers = (r.json?.keys ?? []).filter((k: Record<string, unknown>) => k.hasKey === true);
  check("cleanup: all keys removed", leftovers.length === 0, `${leftovers.length} left`);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
