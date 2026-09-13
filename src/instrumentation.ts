// DEVOPS-1 — start the background workers at server boot.
//
// Previously startWorkers() was lazily triggered by GET /api/network (the
// sidebar footer), so the monitor only ran while a browser was open. The
// DevOps engine must watch miners continuously — instrumentation.register()
// runs once when the Next.js server (nodejs runtime) boots, before traffic.
// startWorkers() itself is idempotent, so dev hot-reloads are safe.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorkers } = await import("./lib/infranex/workers");
    void startWorkers();
  }
}
