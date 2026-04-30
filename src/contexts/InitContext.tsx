import { createContext, useContext } from "react";
import type { InitData } from "@/api/client";
import { API } from "@/config";

const InitContext = createContext<InitData | null>(null);

export function InitProvider({ data, children }: { data: InitData; children: React.ReactNode }) {
  return <InitContext.Provider value={data}>{children}</InitContext.Provider>;
}

export function useInitData(): InitData {
  const ctx = useContext(InitContext);
  if (!ctx) throw new Error("useInitData must be used within <InitProvider>");
  return ctx;
}

export function useCompanyLogoUrl(): string {
  const ctx = useContext(InitContext);
  if (!ctx?.company.logoUrl) return "";
  // Cache-bust to avoid stale logos persisted by Electron/webview cache on POS.
  return `${API.queue}${ctx.company.logoUrl}?v=logo-refresh-20260427`;
}

export function useCompanyName(): string {
  const ctx = useContext(InitContext);
  return ctx?.company.name || "";
}

export function useStationName(): string {
  const ctx = useContext(InitContext);
  return ctx?.station.name || "";
}
