"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function RouteExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="cg-route-stage" data-route={pathname}>
      {children}
    </div>
  );
}
