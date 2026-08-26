import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildRecommendationView, resolveOrg } from "@/lib/data/repository";
import { listDemandSignals, loadBusinessBook, loadHistoryBaseline } from "@/lib/data/commercial-repository";
import { loadSupplyBook } from "@/lib/data/supply-repository";
import { listProjects } from "@/lib/data/project-repository";
import { resolveDemandBook } from "@/lib/demand/resolve";
import { projectValue } from "@/lib/domain/project";
import { buildControlTower } from "@/lib/control-tower/signals";

/**
 * One round trip that assembles the operator briefing. Every input is data the
 * workspace already stores; the prioritisation itself happens in the pure
 * `buildControlTower` engine so it stays testable.
 */
export const getControlTower = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);

    const [recs, supply, business, signals, baseline, projects] = await Promise.all([
      buildRecommendationView(supabase, orgId),
      loadSupplyBook(supabase, orgId),
      loadBusinessBook(supabase, orgId),
      listDemandSignals(supabase, orgId),
      loadHistoryBaseline(supabase, orgId),
      listProjects(supabase, orgId),
    ]);

    const horizon = new Set(baseline.periods);
    const forward = signals.filter(
      (s) => horizon.has(s.expectedPeriod) || s.expectedPeriod >= (baseline.periods[0] ?? ""),
    );
    const demandRows = resolveDemandBook({ signals: forward, history: baseline.points });

    const briefing = buildControlTower({
      today: new Date().toISOString().slice(0, 10),
      recommendations: recs.map((r) => ({
        sku: r.sku,
        name: r.name,
        action: r.action,
        recommendedQty: r.recommendedQty,
        estimatedCost: r.estimatedCost,
        daysOfCover: r.daysOfCover,
        avgMonthlyDemand: r.avgMonthlyDemand,
        excessValue: r.excessValue,
        stockoutRisk: r.stockoutRisk,
        blocked: r.blocked,
        leadTimeDays: r.leadTimeDays,
        onHand: r.onHand,
      })),
      shipments: supply.shipments.map((s) => ({
        id: s.id,
        reference: s.reference,
        status: s.status,
        supplierName: s.supplierName,
        eta: s.eta,
        revisedEta: s.revisedEta,
        arrivedOn: s.arrivedOn,
      })),
      quotations: business.quotations.map((q) => ({
        id: q.id,
        reference: q.reference,
        customerName: q.customerName,
        productName: q.productName,
        quantity: q.quantity,
        unitPrice: q.unitPrice,
        status: q.status,
        issuedOn: q.issuedOn,
        validUntil: q.validUntil,
      })),
      marketSignals: business.marketSignals.map((m) => ({
        id: m.id,
        title: m.title,
        detail: m.detail,
        impact: m.impact,
        observedOn: m.observedOn,
        customerName: m.customerName,
        supplierName: m.supplierName,
      })),
      demandRows: demandRows.map((d) => ({
        sku: d.sku,
        productName: d.productName,
        period: d.period,
        committedQty: d.committedQty,
        resolvedQty: d.resolvedQty,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        customerName: p.customerName,
        stage: p.stage,
        status: p.status,
        expectedValue: projectValue(p),
        expectedClose: p.expectedClose,
      })),
    });

    return {
      ...briefing,
      totals: {
        skus: recs.length,
        openShipments: supply.shipments.filter(
          (s) => s.status !== "delivered" && s.status !== "cancelled",
        ).length,
        openQuotations: business.quotations.filter((q) => q.status === "open").length,
        openProjects: projects.filter((p) => p.status === "open").length,
      },
      calculatedAt: new Date().toISOString(),
    };
  });
