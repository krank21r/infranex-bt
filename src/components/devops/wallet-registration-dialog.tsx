"use client";

// ---------------------------------------------------------------------------
// Wallet & Registration wizard — the missing "connect" step of the journey.
//
// Walks the user through, with copy-paste commands tailored to the wallet
// name and the chosen subnet:
//
//   ON THE LAPTOP (one-time)
//   1  install the Bittensor CLI
//   2  create the COLDKEY  (funds — never leaves the laptop)
//   3  create the HOTKEY   (the miner's identity)
//   4  fund the coldkey (~1 TAO buffer)
//   TO THE GPU HOST
//   5  copy the key files over (the deploy pipeline's Wallet gate wants them)
//   CONNECT TO THE SUBNET
//   6  REGISTER the hotkey (burn → UID — this STARTS the immunity clock)
//   7  restart the miner so it serves its axon on-chain
//   8  VERIFY the UID live against the chain metagraph
//
// Step 8 is the only step the platform can verify by itself: it scans the
// subnet's metagraph for the pasted hotkey SS58 and shows the real UID, its
// telemetry, and the remaining immunity window.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blocksToHours,
  cmds,
  isValidSs58,
  sanitizeWalletName,
  saveWalletRegistration,
  useWalletRegistration,
  type WalletRegistrationState,
  type WalletVerifyResponse,
} from "@/lib/devops/wallet-registration";
import type { RegistrationWizardContext } from "@/lib/infranex/use-deployments";
import type { JourneySubnet } from "./mining-journey";

type VerifyPhase = "idle" | "checking" | "registered" | "none" | "error";
type LinkPhase = "idle" | "linking" | "linked" | "failed";

// One copyable command row.
function CmdRow({ cmd, disabled }: { cmd: string | null; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!cmd) {
    return (
      <p className="rounded-md border border-dashed border-border/60 bg-muted/20 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        pick a subnet in step 1 to generate this command
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the text is selectable anyway */
    }
  };
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5",
        disabled && "opacity-60"
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px]">
        {cmd}
      </code>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        onClick={copy}
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function StepBubble({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
        done
          ? "border-success/50 bg-success/10 text-success"
          : "border-border bg-muted/30 text-muted-foreground"
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

function Step({
  n,
  title,
  done,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        done ? "border-success/30 bg-success/[0.04]" : "border-border/60 bg-background/40"
      )}
    >
      <div className="flex items-center gap-2">
        <StepBubble n={n} done={done} />
        <span className="min-w-0 flex-1 text-xs font-semibold">{title}</span>
        <button
          type="button"
          className={cn(
            "flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
            done
              ? "border-success/40 text-success"
              : "border-border/60 text-muted-foreground hover:text-foreground"
          )}
          onClick={onToggle}
        >
          {done ? <CheckCircle2 className="h-3 w-3" /> : null}
          {done ? "done" : "mark done"}
        </button>
      </div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

export function WalletRegistrationDialog({
  open,
  onOpenChange,
  journey,
  minerDeployed,
  deployment,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  journey: JourneySubnet | null;
  minerDeployed: boolean;
  /** Phase 2 hand-off: register FOR a specific running deployment. */
  deployment?: RegistrationWizardContext | null;
  /** Fired after the verified hotkey was attached to the deployment record. */
  onLinked?: () => void;
}) {
  const reg = useWalletRegistration();
  const [verify, setVerify] = useState<VerifyPhase>("idle");
  const [result, setResult] = useState<WalletVerifyResponse | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [link, setLink] = useState<LinkPhase>("idle");
  const [linkMsg, setLinkMsg] = useState("");

  // Follow the journey subnet whenever the wizard opens.
  useEffect(() => {
    if (open && journey && reg.netuid !== journey.netuid) {
      saveWalletRegistration({ ...reg, netuid: journey.netuid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, journey?.netuid]);

  // Deployment hand-off: lock onto the deployment's subnet + wallet names.
  useEffect(() => {
    if (open && deployment) {
      const needs =
        reg.netuid !== deployment.netuid ||
        reg.walletName !== deployment.walletName ||
        reg.hotkeyName !== deployment.hotkeyName;
      if (needs) {
        saveWalletRegistration({
          ...reg,
          netuid: deployment.netuid,
          walletName: deployment.walletName,
          hotkeyName: deployment.hotkeyName,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deployment?.deploymentId]);

  const netuid = deployment ? deployment.netuid : (reg.netuid ?? journey?.netuid ?? null);
  const c = cmds({ walletName: reg.walletName, hotkeyName: reg.hotkeyName, netuid });
  const scpCmd = deployment ? deployment.scpCommand : c.scp;
  const restartCmd = deployment ? deployment.restartCommand : c.restart;

  const patch = (p: Partial<WalletRegistrationState>) =>
    saveWalletRegistration({ ...reg, ...p });
  const toggleDone = (id: string) =>
    patch({
      doneSteps: reg.doneSteps.includes(id)
        ? reg.doneSteps.filter((s) => s !== id)
        : [...reg.doneSteps, id],
    });

  const runVerify = async () => {
    const hk = reg.hotkeySs58.trim();
    if (!isValidSs58(hk)) {
      setVerify("error");
      setErrMsg("That doesn't look like a hotkey SS58 address (48 characters, starts with '5').");
      return;
    }
    if (!netuid) {
      setVerify("error");
      setErrMsg("Pick a subnet first — the verification is per-subnet.");
      return;
    }
    setVerify("checking");
    setErrMsg("");
    try {
      const res = await fetch(
        `/api/devops/wallet-registration?netuid=${netuid}&hotkey=${encodeURIComponent(hk)}`
      );
      const json = (await res.json()) as WalletVerifyResponse;
      if (!res.ok || !json.ok) {
        setVerify("error");
        setErrMsg(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json);
      if (json.registered) {
        setVerify("registered");
        patch({ verifiedUid: json.uid ?? null, verifiedAt: Date.now(), netuid });
        // Phase 2 hand-off: bind the verified hotkey to the deployment so the
        // record tracks UID + immunity and offers the approval restart.
        if (deployment) {
          setLink("linking");
          setLinkMsg("");
          try {
            const res = await fetch(`/api/deployments/${deployment.deploymentId}/registration`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "attach-hotkey", hotkey: reg.hotkeySs58.trim() }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
            setLink("linked");
            onLinked?.();
          } catch (e) {
            setLink("failed");
            setLinkMsg(e instanceof Error ? e.message : "linking failed");
          }
        }
      } else {
        setVerify("none");
      }
    } catch (e) {
      setVerify("error");
      setErrMsg(e instanceof Error ? e.message : "verification request failed");
    }
  };

  const immunity = result?.immunity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Wallet &amp; registration — connect to the subnet
          </DialogTitle>
          <DialogDescription>
            The engine deploys the software, but your keys and the subnet
            registration can only come from you. Run each command where it says,
            tick it off, and finish with the live on-chain check.
          </DialogDescription>
        </DialogHeader>

        {/* Phase 2 hand-off banner — registering FOR a running deployment */}
        {deployment && (
          <div className="rounded-md border border-primary/30 bg-primary/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Rocket className="h-3.5 w-3.5" />
              Registering for deployment {deployment.minerName}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              α{deployment.netuid} · {deployment.subnetName} — the miner is already running on{" "}
              {deployment.sshHost ?? "the host"} ({deployment.installMode ?? "unknown"} install).
              Registration is the LAST step: it starts the immunity clock, so do it
              only once this miner is healthy. Steps 5 and 7 below target the real
              host, and a successful verify links the hotkey to the deployment
              record automatically.
            </p>
          </div>
        )}

        {/* Wallet identity — commands below re-render from these two names */}
        <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/[0.04] p-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Wallet name (btcli directory)
            </span>
            <Input
              value={reg.walletName}
              onChange={(e) => patch({ walletName: sanitizeWalletName(e.target.value) })}
              className="h-8 font-mono text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Hotkey name
            </span>
            <Input
              value={reg.hotkeyName}
              onChange={(e) => patch({ hotkeyName: sanitizeWalletName(e.target.value) })}
              className="h-8 font-mono text-xs"
            />
          </label>
          {netuid !== null ? (
            <p className="text-[10px] text-muted-foreground sm:col-span-2">
              Must match on BOTH machines: you create the wallet locally with these
              names, and the miner on the GPU host is launched with
              <code className="mx-1 font-mono">--wallet.name {reg.walletName} --wallet.hotkey {reg.hotkeyName}</code>
              — targeting{" "}
              <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] text-primary">
                SN{netuid}
                {journey?.name ? ` · ${journey.name}` : ""}
              </Badge>
            </p>
          ) : (
            <label className="space-y-1">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Netuid (no subnet picked in the journey — enter it manually)
              </span>
              <Input
                value={reg.netuid ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                  patch({ netuid: v === "" ? null : Number(v) });
                }}
                placeholder="e.g. 90"
                className="h-8 font-mono text-xs"
              />
            </label>
          )}
        </div>

        <div className="space-y-2">
          {/* ---------------- ON THE LAPTOP ---------------- */}
          <p className="text-eyebrow pt-1 text-muted-foreground">On your laptop — one-time setup</p>

          <Step n={1} title="Install the Bittensor CLI" done={reg.doneSteps.includes("1")} onToggle={() => toggleDone("1")}>
            <CmdRow cmd={c.install} />
            <p className="text-[11px] text-muted-foreground">
              Needs Python 3.9+. <code className="font-mono">btcli</code> is the wallet &amp; registration tool.
            </p>
          </Step>

          <Step n={2} title="Create the coldkey — your funds; it never leaves this laptop" done={reg.doneSteps.includes("2")} onToggle={() => toggleDone("2")}>
            <CmdRow cmd={c.newColdkey} />
            <p className="flex gap-1.5 rounded-md border border-destructive/30 bg-destructive/[0.05] p-2 text-[11px] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              It prints a 12-word mnemonic ONCE — write it on paper. Anyone who
              has those words owns your TAO. The password you set encrypts the
              key file on disk.
            </p>
          </Step>

          <Step n={3} title="Create the hotkey — the miner's identity" done={reg.doneSteps.includes("3")} onToggle={() => toggleDone("3")}>
            <CmdRow cmd={c.newHotkey} />
            <p className="text-[11px] text-muted-foreground">
              The hotkey is what gets registered on-chain and what the miner
              signs with. Losing it costs nothing — make a new one anytime.
            </p>
          </Step>

          <Step n={4} title="Fund the coldkey — about 1 TAO buffer" done={reg.doneSteps.includes("4")} onToggle={() => toggleDone("4")}>
            <CmdRow cmd={c.overview} />
            <p className="text-[11px] text-muted-foreground">
              Copy the <b className="text-foreground/80">coldkey (ₒ)</b> address
              (starts with <code className="font-mono">5</code>) and withdraw TAO
              to it from your exchange. Registration burns a small dynamic fee
              (~0.0005 TAO on KubeTEE today — see the seat badge on the subnet
              card); the rest of the TAO stays yours as buffer.
            </p>
          </Step>

          {/* ---------------- TO THE GPU HOST ---------------- */}
          <p className="text-eyebrow pt-2 text-muted-foreground">To the GPU host</p>

          <Step n={5} title="Copy the key files to the host" done={reg.doneSteps.includes("5")} onToggle={() => toggleDone("5")}>
            <CmdRow cmd={scpCmd} />
            <p className="text-[11px] text-muted-foreground">
              The deploy pipeline&apos;s Wallet gate checks these files. Hardened
              option: the miner only needs <code className="font-mono">coldkeypub.txt</code> +{" "}
              <code className="font-mono">hotkeys/{reg.hotkeyName}</code> — keep the encrypted
              coldkey file off the box and press the gate&apos;s &quot;confirm in place&quot; instead.
            </p>
          </Step>

          {/* ---------------- CONNECT ---------------- */}
          <p className="text-eyebrow pt-2 text-muted-foreground">Connect to the subnet</p>

          <Step n={6} title="Register the hotkey — this STARTS your immunity clock" done={reg.doneSteps.includes("6")} onToggle={() => toggleDone("6")}>
            <CmdRow cmd={c.register} />
            <p className="flex gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Run this ON THE LAPTOP (the coldkey signs and pays). Register only
              after the miner is deployed and healthy
              {minerDeployed ? " — yours is ✓" : " — yours isn't yet"}: the
              subnet&apos;s immunity window (KubeTEE: 5,000 blocks ≈ 16.7 h)
              starts at this transaction, not when you finish setup.
            </p>
          </Step>

          <Step n={7} title="Restart the miner so it serves its axon" done={reg.doneSteps.includes("7")} onToggle={() => toggleDone("7")}>
            <CmdRow cmd={restartCmd} />
            <p className="text-[11px] text-muted-foreground">
              The miner announces its axon (IP:port) on-chain at startup, which
              is how validators find you.
              {deployment
                ? " Or skip the terminal: press the Restart miner button on the deployment card — the engine runs this over SSH for you."
                : ""}
            </p>
          </Step>

          <Step n={8} title="Verify the UID on-chain" done={reg.doneSteps.includes("8") || verify === "registered"} onToggle={() => toggleDone("8")}>
            <div className="flex gap-2">
              <Input
                value={reg.hotkeySs58}
                onChange={(e) => patch({ hotkeySs58: e.target.value })}
                placeholder="paste your hotkey SS58 (5…)"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={runVerify} disabled={verify === "checking"}>
                {verify === "checking" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Verify
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Find it in the <code className="font-mono">btcli wallet overview</code> output from
              step 4 — the <b className="text-foreground/80">hotkey (ₕ)</b> address.
            </p>

            {verify === "error" && (
              <p className="rounded-md border border-destructive/30 bg-destructive/[0.05] p-2 text-[11px] text-destructive">
                {errMsg}
              </p>
            )}

            {verify === "none" && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] text-amber-600 dark:text-amber-400">
                Not registered on SN{netuid} yet (checked at block{" "}
                {result?.blockNumber ?? "?"}). If you just ran the register
                command, wait one block (~12 s) and verify again.
              </p>
            )}

            {verify === "registered" && result && (
              <div className="space-y-2 rounded-md border border-success/40 bg-success/[0.05] p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  REGISTERED — UID {result.uid} on SN{result.netuid}
                  {journey?.name ? ` (${journey.name})` : ""}
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {[
                    { k: "active", v: result.active ? "yes" : "no" },
                    {
                      k: "incentive",
                      v: result.incentive !== null && result.incentive !== undefined
                        ? `${(result.incentive * 100).toFixed(1)}%`
                        : "—",
                    },
                    {
                      k: "emission",
                      v: result.emissionRaw !== null && result.emissionRaw !== undefined
                        ? `${result.emissionRaw} rAO`
                        : "—",
                    },
                    {
                      k: "block",
                      v: result.blockNumber ? `#${result.blockNumber}` : "—",
                    },
                  ].map((x) => (
                    <div key={x.k} className="rounded border border-border/60 bg-background/50 px-2 py-1">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{x.k}</p>
                      <p className="font-mono text-[11px]">{x.v}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {immunity?.remainingBlocks !== null && immunity?.remainingBlocks !== undefined && immunity.remainingBlocks > 0 ? (
                    <>
                      Immune from eviction for another{" "}
                      <b className="text-foreground/80">{blocksToHours(immunity.remainingBlocks).toFixed(1)} h</b>{" "}
                      (until block {(immunity.registrationBlock ?? 0) + (immunity.blocks ?? 0)}).
                    </>
                  ) : immunity?.blocks !== null && immunity?.blocks !== undefined ? (
                    <>
                      Immunity window:{" "}
                      <b className="text-foreground/80">
                        {immunity.blocks} blocks ≈ {blocksToHours(immunity.blocks).toFixed(1)} h
                      </b>{" "}
                      from your registration block.
                    </>
                  ) : (
                    "Immunity window unknown for this subnet."
                  )}{" "}
                  The UID Defense panel now tracks this UID.
                </p>

                {/* Phase 2 hand-off: link the hotkey to the deployment record */}
                {deployment && (
                  <div className="space-y-1.5">
                    {link === "linking" && (
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Attaching the hotkey to deployment {deployment.minerName}…
                      </p>
                    )}
                    {link === "linked" && (
                      <p className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] p-2 text-[11px] text-primary">
                        <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                        Linked to {deployment.minerName} — the deployment record now
                        tracks UID {result?.uid} and its immunity window. Finish with the
                        <b className="mx-1">Restart miner</b> approval on the deployment card
                        so the axon re-announces for this UID.
                      </p>
                    )}
                    {link === "failed" && (
                      <p className="rounded-md border border-destructive/30 bg-destructive/[0.05] p-2 text-[11px] text-destructive">
                        Linking failed: {linkMsg} — attach it manually from the deployment
                        card (Connect &amp; register → attach) or re-verify.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {verify === "idle" && reg.verifiedUid !== null && (
              <p className="text-[11px] text-muted-foreground">
                Previously verified: UID {reg.verifiedUid}
                {reg.verifiedAt
                  ? ` · ${new Date(reg.verifiedAt).toLocaleString()}`
                  : ""}
                . Re-verify anytime.
              </p>
            )}
          </Step>
        </div>

        <div className="flex items-center justify-between gap-2 pb-1">
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            Progress persists in this browser — the platform never sees your keys.
          </p>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
