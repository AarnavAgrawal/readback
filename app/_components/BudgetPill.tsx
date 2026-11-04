"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "../_lib/format";

type Budget = { spentUsd: number; capUsd: number; remainingUsd: number };

/** Fire this after anything that spends credits so the header pill updates. */
export const BUDGET_EVENT = "atc:budget-changed";
export const refreshBudget = () => window.dispatchEvent(new Event(BUDGET_EVENT));

/** "$X.XX of $800 credits used": total Enhanced Radar usage against the demo's overall cap. */
export function BudgetPill() {
  const [budget, setBudget] = useState<Budget | null>(null);

  useEffect(() => {
    let latest: AbortController | null = null;
    const load = async () => {
      // Each load replaces the one before it, so an older answer can't overwrite a newer one.
      latest?.abort();
      const ctrl = new AbortController();
      latest = ctrl;
      try {
        const res = await fetch("/api/budget", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        const next = (await res.json()) as Budget;
        if (!ctrl.signal.aborted) setBudget(next);
      } catch {
        /* the pill keeps its last value, or stays hidden */
      }
    };
    void load();
    window.addEventListener(BUDGET_EVENT, load);
    return () => {
      latest?.abort();
      window.removeEventListener(BUDGET_EVENT, load);
    };
  }, []);

  if (!budget) return <span className="budget-pill" aria-hidden="true" style={{ visibility: "hidden" }}>$00.00 of $800 used</span>;

  const ratio = budget.capUsd > 0 ? budget.spentUsd / budget.capUsd : 1;
  const level = budget.remainingUsd <= 0 ? "out" : ratio > 0.75 ? "high" : "ok";
  return (
    <span
      className="budget-pill"
      data-level={level}
      title="Enhanced Radar API credits used so far"
    >
      <span className="budget-dot" aria-hidden="true" />
      <span>
        <strong>{formatUsd(budget.spentUsd)}</strong> of {formatUsd(budget.capUsd).replace(/\.00$/, "")}
        <span className="budget-long"> credits</span> used
      </span>
    </span>
  );
}
