"use client";

import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { ActivityEvent, ActivityStatus } from "@/lib/activityLog";
import { cn } from "@/lib/utils";

const ICONS: Record<ActivityStatus, typeof Loader2> = {
  running: Loader2,
  done: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle
};

const COLORS: Record<ActivityStatus, string> = {
  running: "text-[#E10600]",
  done: "text-emerald-500/80",
  warn: "text-amber-500/80",
  error: "text-red-500"
};

interface ActivityLogProps {
  events: ActivityEvent[];
  /** When true, the panel is highlighted as actively in-progress. */
  live?: boolean;
  className?: string;
}

export function ActivityLog({ events, live, className }: ActivityLogProps) {
  if (events.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-md border-l-2 bg-secondary/30 px-3 py-2.5 mb-4",
        live ? "border-[#E10600]" : "border-[#E10600]/40",
        className
      )}
    >
      {live && (
        <div className="mb-2 flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#E10600] animate-pulse" aria-hidden="true" />
          <span className="text-[10px] md:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Working
          </span>
        </div>
      )}
      <ol className="space-y-1.5">
        {events.map((ev) => {
          const Icon = ICONS[ev.status];
          return (
            <li key={ev.id} className="flex items-start gap-2 text-[12px] md:text-[13px]">
              <Icon
                className={cn(
                  "size-3.5 mt-0.5 shrink-0",
                  COLORS[ev.status],
                  ev.status === "running" && "animate-spin"
                )}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground/90">{ev.label}</span>
                {ev.message && (
                  <span className="text-muted-foreground"> — {ev.message}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
