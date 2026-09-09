"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Github, RefreshCw, CheckCircle2, AlertTriangle, ExternalLink, Wand2 } from "lucide-react";
import {
  useSubnetMetadata,
  useSaveOverride,
  useDeleteOverride,
} from "@/lib/infranex/use-subnet-overrides";
import { useToast } from "@/hooks/use-toast";
import type { Subnet } from "@/lib/infranex/types";

interface SubnetEditDialogProps {
  subnet: Subnet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES = [
  "Inference", "Vision", "Training", "Data", "Audio",
  "Compute", "Science", "Security", "DeFi", "Multimodal",
];

export function SubnetEditDialog({ subnet, open, onOpenChange }: SubnetEditDialogProps) {
  const { data: meta, isFetching: scraping } = useSubnetMetadata(
    open && subnet ? subnet.netuid : null
  );
  const saveMut = useSaveOverride();
  const deleteMut = useDeleteOverride();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [minVramGb, setMinVramGb] = useState("");
  const [recommendedGpu, setRecommendedGpu] = useState("");
  const [githubUrl, setGithubUrl] = useState("");

  useEffect(() => {
    if (subnet && open) {
      // Defer to a microtask to avoid setState-in-effect warning.
      void Promise.resolve().then(() => {
        const o = meta?.override;
        const g = meta?.github;
        setName(o?.name ?? subnet.name);
        setDescription(o?.description ?? g?.description ?? subnet.description);
        setCategory(o?.category ?? subnet.category);
        setMinVramGb(String(o?.minVramGb ?? g?.minVramGb ?? subnet.minVramGb));
        setRecommendedGpu(o?.recommendedGpu ?? g?.recommendedGpu ?? subnet.recommendedGpu);
        setGithubUrl(o?.githubUrl ?? subnet.githubUrl ?? "");
      });
    }
  }, [subnet, open, meta]);

  const handleApplyScraped = () => {
    if (!meta?.github) return;
    const g = meta.github;
    if (g.description) setDescription(g.description);
    if (g.minVramGb) setMinVramGb(String(g.minVramGb));
    if (g.recommendedGpu) setRecommendedGpu(g.recommendedGpu);
    toast({ title: "Applied scraped data", description: "Review and save to persist." });
  };

  const handleSave = async () => {
    if (!subnet) return;
    try {
      await saveMut.mutateAsync({
        netuid: subnet.netuid,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        category: category || undefined,
        minVramGb: minVramGb ? parseInt(minVramGb, 10) : undefined,
        recommendedGpu: recommendedGpu.trim() || undefined,
        githubUrl: githubUrl.trim() || undefined,
      });
      toast({ title: "Saved", description: `Override saved for ${subnet.name} (α${subnet.netuid})` });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Failed to save",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleReset = async () => {
    if (!subnet) return;
    try {
      await deleteMut.mutateAsync(subnet.netuid);
      toast({ title: "Reset to curated", description: `Override removed for ${subnet.name}` });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Failed to reset",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const hasOverride = !!meta?.override;
  const hasScraped = meta?.github?.source === "github";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto custom-scroll">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <DialogTitle className="text-display text-2xl">
              Edit Subnet Metadata
            </DialogTitle>
          </div>
          <DialogDescription>
            {subnet && `${subnet.name} (α${subnet.netuid}) — override curated values with your own or scraped data.`}
          </DialogDescription>
        </DialogHeader>

        {/* GitHub scraping section */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">GitHub metadata scraper</p>
            </div>
            {scraping && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                Scraping…
              </Badge>
            )}
          </div>

          <div className="mt-3">
            <Label htmlFor="github-url" className="text-xs">GitHub repo URL</Label>
            <Input
              id="github-url"
              placeholder="https://github.com/org/subnet-repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              className="mt-1 mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Enter the subnet&apos;s GitHub repo URL to scrape its README and requirements.txt for real GPU requirements.
            </p>
          </div>

          {meta?.github && (
            <div className="mt-3 space-y-2">
              {meta.github.source === "github" ? (
                <div className="rounded-md border border-success/30 bg-success/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-xs font-medium text-success">Scraped successfully</span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {meta.github.description && (
                      <div><span className="text-muted-foreground">Description:</span> {meta.github.description.slice(0, 100)}…</div>
                    )}
                    {meta.github.minVramGb && (
                      <div><span className="text-muted-foreground">Min VRAM:</span> <span className="mono font-medium">{meta.github.minVramGb} GB</span></div>
                    )}
                    {meta.github.recommendedGpu && (
                      <div><span className="text-muted-foreground">GPU:</span> <span className="font-medium">{meta.github.recommendedGpu}</span></div>
                    )}
                    {meta.github.readmeUrl && (
                      <a href={meta.github.readmeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> View README
                      </a>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={handleApplyScraped}>
                    <Wand2 className="h-3 w-3" />
                    Apply scraped values
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border border-warning/30 bg-warning/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <span className="text-xs font-medium text-warning">Could not scrape</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{meta.github.error}</p>
                </div>
              )}
            </div>
          )}

          {meta?.metadataApi?.found && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/[0.04] p-2 text-xs">
              <span className="text-primary">Metadata API found</span> at{" "}
              <span className="mono">{meta.metadataApi.probed.find((u) => u)}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Editable fields */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="name" className="text-sm font-medium">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="description" className="text-sm font-medium">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vram" className="text-sm font-medium">Min VRAM (GB)</Label>
              <Input
                id="vram"
                type="number"
                value={minVramGb}
                onChange={(e) => setMinVramGb(e.target.value)}
                className="mt-1 mono"
              />
            </div>
            <div>
              <Label htmlFor="gpu" className="text-sm font-medium">Recommended GPU</Label>
              <Input
                id="gpu"
                value={recommendedGpu}
                onChange={(e) => setRecommendedGpu(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {/* Data source indicators */}
        <div className="rounded-lg border border-border/40 bg-background/60 p-3">
          <p className="text-eyebrow text-muted-foreground mb-2">Data sources</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-success/30 text-success">
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-success" />
              Chain (live): miners, TAO, price, tempo
            </Badge>
            {hasScraped && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                <Github className="mr-1 h-3 w-3" />
                GitHub (scraped)
              </Badge>
            )}
            {hasOverride && (
              <Badge variant="outline" className="border-warning/30 text-warning">
                <Wand2 className="mr-1 h-3 w-3" />
                User override
              </Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">
              Curated (default)
            </Badge>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {hasOverride && (
            <Button variant="ghost" size="sm" className="mr-auto gap-1.5 text-muted-foreground" onClick={handleReset} disabled={deleteMut.isPending}>
              Reset to curated
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveMut.isPending} className="gap-2">
            {saveMut.isPending ? "Saving…" : "Save override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
