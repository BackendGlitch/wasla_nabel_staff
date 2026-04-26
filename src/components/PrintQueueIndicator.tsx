import { useEffect, useMemo, useState } from "react";
import { printerService, DurablePrintJobRecord } from "@/services/printerService";
import { Badge } from "@/components/ui/badge";

type Props = {
  compact?: boolean;
};

export default function PrintQueueIndicator({ compact = true }: Props) {
  const [jobs, setJobs] = useState<DurablePrintJobRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        const list = await printerService.listDurablePrintJobs(50);
        if (!cancelled) setJobs(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load print jobs");
      }
    };

    load();
    const id = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const summary = useMemo(() => {
    let pending = 0;
    let printing = 0;
    let failed = 0;
    for (const j of jobs) {
      if (j.status === "pending") pending++;
      if (j.status === "printing") printing++;
      if (j.status === "failed") failed++;
    }
    return { pending, printing, failed };
  }, [jobs]);

  if (!compact) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={summary.pending > 0 ? "secondary" : "outline"} className="text-xs">
          File: {summary.pending}
        </Badge>
        <Badge variant={summary.printing > 0 ? "default" : "outline"} className="text-xs">
          Impression: {summary.printing}
        </Badge>
        {summary.failed > 0 && (
          <Badge variant="destructive" className="text-xs">
            Échecs: {summary.failed}
          </Badge>
        )}
        {error && (
          <span className="text-xs text-red-600" title={error}>
            Jobs indisponibles
          </span>
        )}
      </div>
    );
  }

  // Compact: one badge (plus failure badge)
  return (
    <div className="flex items-center gap-2">
      <Badge variant={summary.pending > 0 ? "secondary" : "outline"} className="text-xs">
        Jobs: {summary.pending}
      </Badge>
      {summary.failed > 0 && (
        <Badge variant="destructive" className="text-xs">
          {summary.failed} échec{summary.failed === 1 ? "" : "s"}
        </Badge>
      )}
      {error && (
        <span className="text-xs text-red-600" title={error}>
          !
        </span>
      )}
    </div>
  );
}

