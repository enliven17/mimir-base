/**
 * Product analytics definitions kept in version control.
 *
 * PostHog is a projection of these definitions, never a financial source of
 * truth. Keeping the event order, conversion windows, exclusions and breakdowns
 * here makes a dashboard reproducible after a project reset and reviewable like
 * application code.
 */

import type { AnalyticsEvent } from "./events";

export interface FunnelDefinition {
  id: string;
  name: string;
  events: readonly AnalyticsEvent[];
  conversionWindowDays: number;
  breakdowns: readonly ("settlement_mode" | "category" | "actor_type")[];
  excludeInternal: boolean;
}

export interface DashboardDefinition {
  id: string;
  name: string;
  funnelIds: readonly string[];
  breakdowns: readonly ("settlement_mode" | "category" | "actor_type")[];
  retention: readonly {
    name: string;
    returningEvent: AnalyticsEvent;
    period: "day" | "week" | "month";
  }[];
}

export const PRODUCT_FUNNELS = [
  {
    id: "create",
    name: "Create → confirmed",
    events: ["create_started", "create_submitted", "create_confirmed"],
    conversionWindowDays: 1,
    breakdowns: ["settlement_mode", "category", "actor_type"],
    excludeInternal: true,
  },
  {
    id: "stake",
    name: "Market view → stake confirmed",
    events: ["market_viewed", "stake_started", "stake_confirmed"],
    conversionWindowDays: 7,
    breakdowns: ["settlement_mode", "category", "actor_type"],
    excludeInternal: true,
  },
  {
    id: "settlement-return",
    name: "Stake → settlement return",
    events: ["stake_confirmed", "settlement_return_viewed"],
    conversionWindowDays: 30,
    breakdowns: ["settlement_mode", "category", "actor_type"],
    excludeInternal: true,
  },
  {
    id: "follow-to-copy",
    name: "Follow → copy execution",
    events: ["agent_followed", "copy_permission_created", "copy_executed"],
    conversionWindowDays: 30,
    breakdowns: ["category", "actor_type"],
    excludeInternal: true,
  },
  {
    id: "share-to-market",
    name: "Shared visit → market view → stake",
    events: ["share_card_clicked", "market_viewed", "stake_confirmed"],
    conversionWindowDays: 7,
    breakdowns: ["settlement_mode", "category", "actor_type"],
    excludeInternal: true,
  },
] as const satisfies readonly FunnelDefinition[];

export const PRODUCT_DASHBOARDS = [
  {
    id: "conversion",
    name: "Mimir conversion",
    funnelIds: ["create", "stake", "settlement-return", "follow-to-copy", "share-to-market"],
    breakdowns: ["settlement_mode", "category", "actor_type"],
    retention: [],
  },
  {
    id: "retention",
    name: "Mimir retention",
    funnelIds: ["create", "stake"],
    breakdowns: ["settlement_mode", "category", "actor_type"],
    retention: [
      { name: "D1 creator", returningEvent: "create_started", period: "day" },
      { name: "D7 challenger", returningEvent: "market_viewed", period: "week" },
      { name: "D30 agent owner", returningEvent: "agent_viewed", period: "month" },
    ],
  },
] as const satisfies readonly DashboardDefinition[];

export function analyticsDefinitionErrors(): string[] {
  const errors: string[] = [];
  const funnelIds = new Set(PRODUCT_FUNNELS.map((funnel) => funnel.id));
  for (const dashboard of PRODUCT_DASHBOARDS) {
    for (const id of dashboard.funnelIds) {
      if (!funnelIds.has(id)) errors.push(`${dashboard.id}: unknown funnel '${id}'`);
    }
  }
  return errors;
}
