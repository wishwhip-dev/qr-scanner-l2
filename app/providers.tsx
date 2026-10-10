"use client";

import { Toaster } from "sonner";
import { VisitBeacon } from "@/components/visit-beacon";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}<Toaster richColors position="top-right" /><VisitBeacon /></>;
}
