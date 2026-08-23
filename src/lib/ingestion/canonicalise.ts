import type {
  CanonicalChannel,
  CanonicalCustomer,
  CanonicalDataset,
  CanonicalForecast,
  CanonicalInventory,
  CanonicalMovement,
  CanonicalProduct,
  CanonicalPurchaseOrder,
  CanonicalSale,
  CanonicalSupplier,
  CanonicalTransaction,
  PurchaseOrderApprovalStatus,
  PurchaseOrderStatus,
} from "@/lib/domain/model";
import { movementClassFromReason } from "@/lib/domain/movement";
import { csvConnector } from "@/lib/connectors/csv-connector";
import { LIMITS, cell, type SheetTable } from "./sheet-table";
import type { ColumnMapping, EntityKind } from "./mapping";
import { IssueLog, monthOf, parseCurrency, parseDate, parseNumber, outOfRange, rowHash, safeText } from "./validate";

/** A user-confirmed decision about one sheet in an upload. */
export interface SheetPlan {
  sheetName: string;
  kind: EntityKind;
  mapping: ColumnMapping;
}

export interface CanonicalisationResult {
  dataset: CanonicalDataset;
  issues: ReturnType<IssueLog["list"]>;
  stats: { rowsRead: number; rowsAccepted: number; rowsRejected: number; warnings: number };
  /** Distinct SKUs referenced by fact sheets, so unknown references can be checked. */
  referencedSkus: string[];
}

const emptyDataset = (): Required<CanonicalDataset> => ({
  suppliers: [],
  products: [],
  inventory: [],
  sales: [],
  customers: [],
  channels: [],
  transactions: [],
  purchaseOrders: [],
  forecasts: [],
  movements: [],
});

function supplierCodeFrom(code: string, name: string): string {
  return (
    safeText(code).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) ||
    safeText(name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) ||
    "UNASSIGNED"
  );
}

/** Re-serialises a mapped sheet as canonical CSV so combined sheets reuse the proven CSV path. */
function sheetToCanonicalCsv(sheet: SheetTable, mapping: ColumnMapping): string {
  const fields = Object.keys(mapping);
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [fields.join(",")];
  for (const row of sheet.rows) {
    lines.push(fields.map((f) => quote(cell(row, mapping[f]!))).join(","));
  }
  return lines.join("\n");
}

/**
 * Sheets + confirmed mappings → the canonical model.
 *
 * Validation is deterministic and rule-based: nothing is inferred beyond the
 * column mapping the user confirmed, and no value is invented to fill a gap.
 */
export function canonicalise(sheets: SheetTable[], plans: SheetPlan[]): CanonicalisationResult {
  const log = new IssueLog();
  const out = emptyDataset();
  const products = new Map<string, CanonicalProduct>();
  const suppliers = new Map<string, CanonicalSupplier>();
  const inventory = new Map<string, CanonicalInventory>();
  const sales = new Map<string, CanonicalSale>();
  const customers = new Map<string, CanonicalCustomer>();
  const channels = new Map<string, CanonicalChannel>();
  const transactions: CanonicalTransaction[] = [];
  const purchaseOrders: CanonicalPurchaseOrder[] = [];
  const forecasts = new Map<string, CanonicalForecast>();
  const movements: CanonicalMovement[] = [];
  const referenced = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  let rowsRead = 0;
  let rowsAccepted = 0;
  let rowsRejected = 0;

  for (const plan of plans) {
    if (plan.kind === "ignored") continue;
    const sheet = sheets.find((s) => s.sheetName === plan.sheetName);
    if (!sheet) continue;
    if (sheet.truncated) {
      log.add(sheet.sheetName, 0, "file", `Sheet has ${sheet.rowCount} rows; only the first ${LIMITS.maxRowsPerSheet} were read.`, "warning");
    }
    const get = (row: string[], field: string) => cell(row, plan.mapping[field] ?? -1);
    const num = (row: string[], field: string) => parseNumber(get(row, field));

    if (plan.kind === "combined") {
      // Delegates to the existing CSV canonicaliser so behaviour for the
      // original upload format is unchanged.
      const result = csvConnector.parse(sheetToCanonicalCsv(sheet, plan.mapping));
      for (const issue of result.issues) {
        log.add(sheet.sheetName, issue.row, issue.field, issue.message, issue.severity);
      }
      for (const s of result.dataset.suppliers) if (!suppliers.has(s.code)) suppliers.set(s.code, s);
      for (const p of result.dataset.products) if (!products.has(p.sku)) products.set(p.sku, p);
      for (const i of result.dataset.inventory) inventory.set(`${i.sku}|${i.location}`, i);
      for (const s of result.dataset.sales) {
        const key = `${s.sku}|${s.periodMonth}`;
        const existing = sales.get(key);
        sales.set(key, existing ? { ...existing, quantity: existing.quantity + s.quantity, revenue: existing.revenue + s.revenue } : s);
      }
      rowsRead += result.stats.rowsRead;
      rowsAccepted += result.stats.rowsAccepted;
      rowsRejected += result.stats.rowsRejected;
      continue;
    }

    sheet.rows.forEach((row, index) => {
      const rowNo = index + 2; // 1-based, header row included
      rowsRead++;

      const reject = (field: string, message: string) => {
        log.add(sheet.sheetName, rowNo, field, message, "error");
        rowsRejected++;
      };

      switch (plan.kind) {
        case "suppliers": {
          const name = safeText(get(row, "supplier_name"));
          if (!name) return reject("supplier_name", "Missing supplier name. Row rejected.");
          const code = supplierCodeFrom(get(row, "supplier_code"), name);
          const lead = num(row, "lead_time_days");
          const moq = num(row, "moq");
          const reliability = num(row, "reliability");
          if (lead.malformed || moq.malformed || reliability.malformed) {
            return reject("lead_time_days", "A numeric column is not a valid number. Row rejected.");
          }
          suppliers.set(code, {
            externalRef: code,
            name,
            code,
            leadTimeDays: lead.value != null ? Math.max(0, Math.round(lead.value)) : 0,
            minOrderQty: moq.value != null ? Math.max(1, Math.round(moq.value)) : 1,
            reliability: reliability.value != null && reliability.value > 0 && reliability.value <= 1 ? reliability.value : 0.95,
          });
          rowsAccepted++;
          return;
        }

        case "products": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          if (!products.has(sku) && products.size >= LIMITS.maxSkus) {
            return reject("sku", "The SKU limit for a single import was reached. Row rejected.");
          }
          const cost = num(row, "unit_cost");
          const price = num(row, "unit_price");
          const lead = num(row, "lead_time_days");
          const moq = num(row, "moq");
          const safety = num(row, "safety_stock_days");
          for (const [field, parsed] of [["unit_cost", cost], ["unit_price", price], ["lead_time_days", lead], ["moq", moq], ["safety_stock_days", safety]] as const) {
            if (parsed.malformed) return reject(field, `"${get(row, field)}" is not a valid number. Row rejected.`);
            if (outOfRange(parsed.value)) return reject(field, `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`);
          }
          if (cost.value != null && cost.value < 0) return reject("unit_cost", "Unit cost cannot be negative. Row rejected.");
          if (lead.value == null) {
            log.add(sheet.sheetName, rowNo, "lead_time_days", `No lead time for ${sku}. A reorder point cannot be calculated unless its supplier declares one.`, "warning");
          }
          const supplierName = safeText(get(row, "supplier_name"), "Unassigned supplier");
          const code = supplierCodeFrom(get(row, "supplier_code"), supplierName);
          if (!suppliers.has(code)) {
            suppliers.set(code, {
              externalRef: code,
              name: supplierName,
              code,
              leadTimeDays: lead.value != null ? Math.max(0, Math.round(lead.value)) : 0,
              minOrderQty: moq.value != null ? Math.max(1, Math.round(moq.value)) : 1,
              reliability: 0.95,
            });
          }
          products.set(sku, {
            sku,
            name: safeText(get(row, "product_name"), sku),
            category: safeText(get(row, "category"), "Uncategorised"),
            unitCost: cost.value ?? 0,
            unitPrice: price.value,
            supplierCode: code,
            leadTimeDays: lead.value != null ? Math.max(1, Math.round(lead.value)) : null,
            minOrderQty: moq.value != null ? Math.max(1, Math.round(moq.value)) : null,
            safetyStockDays: Math.max(0, Math.round(safety.value ?? 14)),
          });
          rowsAccepted++;
          return;
        }

        case "inventory": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const onHand = num(row, "on_hand");
          const onOrder = num(row, "on_order");
          if (onHand.malformed || onOrder.malformed) return reject("on_hand", "Stock quantity is not a valid number. Row rejected.");
          if (onHand.value == null) return reject("on_hand", "Missing stock on hand. Row rejected.");
          if (onHand.value < 0 || (onOrder.value ?? 0) < 0) return reject("on_hand", "Stock quantities cannot be negative. Row rejected.");
          if (outOfRange(onHand.value) || outOfRange(onOrder.value)) return reject("on_hand", "Stock quantity is outside the supported range. Row rejected.");
          const location = safeText(get(row, "location"), "MAIN");
          const asOf = parseDate(get(row, "as_of")) ?? today;
          referenced.add(sku);
          const key = `${sku}|${location}`;
          if (inventory.has(key)) {
            log.add(sheet.sheetName, rowNo, "sku", `A second row for ${sku} at ${location} appears in this import — the later row replaces the earlier one.`, "warning");
          }
          inventory.set(key, { sku, onHand: onHand.value, onOrder: onOrder.value ?? 0, location, asOf });
          rowsAccepted++;
          return;
        }

        case "sales_monthly": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const iso = parseDate(get(row, "month"));
          if (!iso) return reject("month", `Unrecognised period "${get(row, "month")}". Row rejected.`);
          const qty = num(row, "units_sold");
          const revenue = num(row, "revenue");
          const cogs = num(row, "cogs");
          if (qty.malformed || revenue.malformed || cogs.malformed) return reject("units_sold", "A numeric column is not a valid number. Row rejected.");
          if (qty.value == null) return reject("units_sold", "Missing quantity sold. Row rejected.");
          if (outOfRange(qty.value) || outOfRange(revenue.value) || outOfRange(cogs.value)) {
            return reject("units_sold", "A value is outside the supported range. Row rejected.");
          }
          const month = monthOf(iso);
          if (month > today) {
            log.add(sheet.sheetName, rowNo, "month", `Period ${month.slice(0, 7)} is in the future and was excluded from demand history.`, "warning");
            rowsRejected++;
            return;
          }
          referenced.add(sku);
          const key = `${sku}|${month}`;
          const existing = sales.get(key);
          sales.set(key, {
            sku,
            periodMonth: month,
            quantity: (existing?.quantity ?? 0) + qty.value,
            revenue: (existing?.revenue ?? 0) + (revenue.value ?? 0),
            cogs: cogs.value == null && existing?.cogs == null ? null : (existing?.cogs ?? 0) + (cogs.value ?? 0),
          });
          rowsAccepted++;
          return;
        }

        case "transactions": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const occurredOn = parseDate(get(row, "transaction_date"));
          if (!occurredOn) return reject("transaction_date", `Unrecognised date "${get(row, "transaction_date")}". Row rejected.`);
          const qty = num(row, "quantity");
          const value = num(row, "revenue");
          const price = num(row, "unit_price");
          const cogs = num(row, "cogs");
          const original = num(row, "original_amount");
          for (const [field, parsed] of [["quantity", qty], ["revenue", value], ["unit_price", price], ["cogs", cogs], ["original_amount", original]] as const) {
            if (parsed.malformed) return reject(field, `"${get(row, field)}" is not a valid number. Row rejected.`);
            if (outOfRange(parsed.value)) return reject(field, `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`);
          }
          if (qty.value == null) return reject("quantity", "Missing quantity. Row rejected.");
          if (occurredOn > today) {
            log.add(sheet.sheetName, rowNo, "transaction_date", `${occurredOn} is in the future and was excluded from demand history.`, "warning");
            rowsRejected++;
            return;
          }
          const customerName = safeText(get(row, "customer_name"));
          const customerRefRaw = safeText(get(row, "customer_ref"));
          const customerRef = customerRefRaw || (customerName ? customerName.toUpperCase() : "");
          if (customerRef && !customers.has(customerRef)) {
            customers.set(customerRef, { externalRef: customerRef, name: customerName || customerRef, segment: safeText(get(row, "segment")) || null });
          }
          const channelName = safeText(get(row, "channel_name"));
          const channelCodeRaw = safeText(get(row, "channel_code"));
          const channelCode = channelCodeRaw || (channelName ? channelName.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 32) : "");
          if (channelCode && !channels.has(channelCode)) {
            channels.set(channelCode, { code: channelCode, name: channelName || channelCode });
          }
          const currency = parseCurrency(get(row, "currency_code"));
          if (get(row, "currency_code") && !currency) {
            log.add(sheet.sheetName, rowNo, "currency_code", `"${get(row, "currency_code")}" is not a three-letter currency code and was not stored.`, "warning");
          }
          const location = safeText(get(row, "location")) || null;
          const sourceRef = safeText(get(row, "source_ref")) || null;
          referenced.add(sku);
          transactions.push({
            sku,
            occurredOn,
            quantity: qty.value,
            value: value.value,
            unitPrice: price.value,
            cogs: cogs.value,
            customerRef: customerRef || null,
            channelCode: channelCode || null,
            location,
            region: safeText(get(row, "region")) || null,
            stateProvince: safeText(get(row, "state_province")) || null,
            currencyCode: currency,
            originalAmount: original.value,
            sourceRef,
            rowHash: rowHash([sku, occurredOn, qty.value, value.value, customerRef, channelCode, location, sourceRef]),
          });
          rowsAccepted++;
          return;
        }

        case "purchase_orders": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const qty = num(row, "quantity");
          const received = num(row, "received_quantity");
          const cost = num(row, "unit_cost");
          for (const [field, parsed] of [["quantity", qty], ["received_quantity", received], ["unit_cost", cost]] as const) {
            if (parsed.malformed) return reject(field, `"${get(row, field)}" is not a valid number. Row rejected.`);
            if (outOfRange(parsed.value)) return reject(field, `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`);
          }
          if (qty.value == null) return reject("quantity", "Missing order quantity. Row rejected.");
          if (qty.value <= 0) return reject("quantity", "Order quantity must be greater than zero. Row rejected.");
          if (cost.value != null && cost.value < 0) return reject("unit_cost", "Unit cost cannot be negative. Row rejected.");
          if (received.value != null && received.value < 0) return reject("received_quantity", "Received quantity cannot be negative. Row rejected.");
          let receivedQuantity = received.value ?? 0;
          if (receivedQuantity > qty.value) {
            log.add(sheet.sheetName, rowNo, "received_quantity", "Received quantity exceeds the ordered quantity; capped at the ordered quantity.", "warning");
            receivedQuantity = qty.value;
          }
          const orderedRaw = get(row, "ordered_at");
          const orderedAt = parseDate(orderedRaw);
          if (orderedRaw?.trim() && !orderedAt) {
            log.add(sheet.sheetName, rowNo, "ordered_at", `Unrecognised order date "${safeText(orderedRaw)}". The row is kept without it.`, "warning");
          }
          const expectedRaw = get(row, "expected_at");
          const expectedAt = parseDate(expectedRaw);
          if (expectedRaw?.trim() && !expectedAt) {
            log.add(sheet.sheetName, rowNo, "expected_at", `Unrecognised expected date "${safeText(expectedRaw)}". The line is kept as unscheduled supply.`, "warning");
          }
          const receivedRaw = get(row, "received_at");
          const receivedAt = parseDate(receivedRaw);
          if (receivedRaw?.trim() && !receivedAt) {
            log.add(sheet.sheetName, rowNo, "received_at", `Unrecognised receipt date "${safeText(receivedRaw)}". The row is kept without it.`, "warning");
          }
          const currency = parseCurrency(get(row, "currency_code"));
          if (get(row, "currency_code") && !currency) {
            log.add(sheet.sheetName, rowNo, "currency_code", `"${get(row, "currency_code")}" is not a three-letter currency code and was not stored.`, "warning");
          }
          const status = parsePoStatus(get(row, "po_status"), (message) =>
            log.add(sheet.sheetName, rowNo, "po_status", message, "warning"),
          );
          const approvalStatus = parsePoApproval(get(row, "po_status"), get(row, "approval_status"));
          referenced.add(sku);
          purchaseOrders.push({
            poRef: safeText(get(row, "po_ref")) || null,
            status,
            approvalStatus,
            sku,
            supplierCode: safeText(get(row, "supplier_code")) || null,
            supplierName: safeText(get(row, "supplier_name")) || null,
            quantity: qty.value,
            receivedQuantity,
            unitCost: cost.value,
            orderedAt,
            expectedAt,
            receivedAt,
            location: safeText(get(row, "location")) || null,
            currencyCode: currency,
            buyer: safeText(get(row, "buyer")) || null,
            // The fingerprint identifies the business LINE only. Mutable
            // operational fields (status, approvals, receipts, dates) are
            // updated in place on re-import and never join the hash — an
            // updated PO must be recognised as the same PO.
            rowHash: rowHash([sku, qty.value, safeText(get(row, "po_ref")), safeText(get(row, "supplier_code")) || safeText(get(row, "supplier_name"))]),
          });
          rowsAccepted++;
          return;
        }

        case "demand_forecast": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const iso = parseDate(get(row, "forecast_period"));
          if (!iso) return reject("forecast_period", `Unrecognised period "${get(row, "forecast_period")}". Row rejected.`);
          const base = num(row, "baseline_qty");
          const low = num(row, "low_qty");
          const high = num(row, "high_qty");
          for (const [field, parsed] of [["baseline_qty", base], ["low_qty", low], ["high_qty", high]] as const) {
            if (parsed.malformed) return reject(field, `"${get(row, field)}" is not a valid number. Row rejected.`);
            if (outOfRange(parsed.value)) return reject(field, `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`);
          }
          if (base.value == null) return reject("baseline_qty", "Missing baseline quantity. Row rejected.");
          if (base.value < 0 || (low.value ?? 0) < 0 || (high.value ?? 0) < 0) {
            return reject("baseline_qty", "Forecast quantities cannot be negative. Row rejected.");
          }
          const periodMonth = monthOf(iso);
          if (periodMonth <= `${today.slice(0, 7)}-01`) {
            log.add(sheet.sheetName, rowNo, "forecast_period", `Period ${periodMonth.slice(0, 7)} is not in the future — the row is kept, but review whether this is really forward demand.`, "warning");
          }
          if (low.value != null && high.value != null && low.value > high.value) {
            log.add(sheet.sheetName, rowNo, "low_qty", "The low scenario exceeds the high scenario; values are kept as provided.", "warning");
          }
          const location = safeText(get(row, "location"), "MAIN");
          referenced.add(sku);
          // The fingerprint identifies the forecast cell (SKU, period,
          // location) only — scenario bounds are updated by re-import, never
          // duplicated.
          const key = `${sku}|${periodMonth}|${location}`;
          if (forecasts.has(key)) {
            log.add(sheet.sheetName, rowNo, "sku", `A second forecast for ${sku} in ${periodMonth.slice(0, 7)} at ${location} appears in this import — the later row replaces the earlier one.`, "warning");
          }
          forecasts.set(key, {
            sku,
            periodMonth,
            baselineQty: base.value,
            lowQty: low.value,
            highQty: high.value,
            method: safeText(get(row, "forecast_method")) || null,
            location,
            sourceRef: safeText(get(row, "source_ref")) || null,
            rowHash: rowHash([sku, periodMonth, location]),
          });
          rowsAccepted++;
          return;
        }

        case "inventory_movement": {
          const sku = safeText(get(row, "sku"));
          if (!sku) return reject("sku", "Missing SKU. Row rejected.");
          const occurredOn = parseDate(get(row, "transaction_date"));
          if (!occurredOn) return reject("transaction_date", `Unrecognised date "${get(row, "transaction_date")}". Row rejected.`);
          const qty = num(row, "movement_qty");
          const value = num(row, "value");
          const cogs = num(row, "cogs");
          const original = num(row, "original_amount");
          for (const [field, parsed] of [["movement_qty", qty], ["value", value], ["cogs", cogs], ["original_amount", original]] as const) {
            if (parsed.malformed) return reject(field, `"${get(row, field)}" is not a valid number. Row rejected.`);
            if (outOfRange(parsed.value)) return reject(field, `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`);
          }
          if (qty.value == null) return reject("movement_qty", "Missing movement quantity. Row rejected.");
          if (occurredOn > today) {
            log.add(sheet.sheetName, rowNo, "transaction_date", `${occurredOn} is in the future; the movement is kept but review whether the date is correct.`, "warning");
          }
          const currency = parseCurrency(get(row, "currency_code"));
          if (get(row, "currency_code") && !currency) {
            log.add(sheet.sheetName, rowNo, "currency_code", `"${get(row, "currency_code")}" is not a three-letter currency code and was not stored.`, "warning");
          }
          const sourceReason = safeText(get(row, "movement_type")) || null;
          const movementClass = movementClassFromReason(sourceReason);
          const location = safeText(get(row, "location")) || null;
          const sourceRef = safeText(get(row, "source_ref")) || null;
          referenced.add(sku);
          // A value of 0 is valid and distinct from null (value not supplied).
          // Direction comes from the signed quantity, never from a sign
          // convention column.
          movements.push({
            sku,
            occurredOn,
            quantity: qty.value,
            movementClass,
            sourceReason,
            location,
            sourceRef,
            value: value.value,
            currencyCode: currency,
            originalAmount: original.value,
            cogs: cogs.value,
            rowHash: rowHash([sku, occurredOn, qty.value, movementClass, sourceReason, location, sourceRef]),
          });
          rowsAccepted++;
          return;
        }

        case "customers": {
          const name = safeText(get(row, "customer_name"));
          if (!name) return reject("customer_name", "Missing customer name. Row rejected.");
          const ref = safeText(get(row, "customer_ref")) || name.toUpperCase();
          customers.set(ref, { externalRef: ref, name, segment: safeText(get(row, "segment")) || null });
          rowsAccepted++;
          return;
        }

        case "channels": {
          const name = safeText(get(row, "channel_name"));
          if (!name) return reject("channel_name", "Missing channel name. Row rejected.");
          const code = safeText(get(row, "channel_code")) || name.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 32);
          channels.set(code, { code, name });
          rowsAccepted++;
          return;
        }

        default:
          return;
      }
    });
  }

  // Transactions are NOT folded into the monthly grain here. Persistence
  // rebuilds monthly sales from stored transactions, so a re-import never
  // double counts and existing months are never overwritten by a partial file.

  out.suppliers = [...suppliers.values()];
  out.products = [...products.values()];
  out.inventory = [...inventory.values()];
  out.sales = [...sales.values()];
  out.customers = [...customers.values()];
  out.channels = [...channels.values()];
  out.transactions = transactions;
  out.purchaseOrders = purchaseOrders;
  out.forecasts = [...forecasts.values()];
  out.movements = movements;

  return {
    dataset: out,
    issues: log.list(),
    stats: { rowsRead, rowsAccepted, rowsRejected, warnings: log.warnings },
    referencedSkus: [...referenced],
  };
}

/**
 * Maps a source status word onto the canonical PO lifecycle. Unknown values
 * are kept as "placed" with a warning — the outstanding quantity still
 * represents real expected supply, so the row is not dropped over vocabulary.
 *
 * Lifecycle only: approval is parsed separately (parsePoApproval) so the two
 * dimensions never share one field.
 */
const PO_STATUS_MAP: Record<string, PurchaseOrderStatus> = {
  draft: "draft",
  placed: "placed",
  open: "placed",
  confirmed: "placed",
  approved: "placed",
  ordered: "placed",
  sent: "placed",
  in_progress: "placed",
  partially_received: "placed",
  partial: "placed",
  received: "received",
  complete: "received",
  completed: "received",
  delivered: "received",
  fulfilled: "received",
  closed: "closed",
  rejected: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
  void: "cancelled",
};

function parsePoStatus(raw: string, warn: (message: string) => void): PurchaseOrderStatus {
  const key = safeText(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "placed";
  const mapped = PO_STATUS_MAP[key];
  if (mapped) return mapped;
  warn(`Unknown purchase order status "${safeText(raw)}" — treated as placed.`);
  return "placed";
}

/**
 * Approval signal, kept independent of the lifecycle. An explicit approval
 * column wins; then a clear approval/rejection word in the status; known
 * lifecycle words describing real external orders imply approval happened;
 * drafts, blanks and unknown vocabulary need review.
 */
function parsePoApproval(statusRaw: string, approvalRaw: string): PurchaseOrderApprovalStatus {
  const explicit = safeText(approvalRaw).toLowerCase().replace(/[\s-]+/g, "_");
  if (["approved", "approve", "yes", "true"].includes(explicit)) return "approved";
  if (["rejected", "declined"].includes(explicit)) return "rejected";
  if (["needs_review", "pending", "pending_approval", "unapproved", "draft", "no", "false"].includes(explicit)) {
    return "needs_review";
  }
  const key = safeText(statusRaw).toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "rejected") return "rejected";
  if (key === "" || key === "draft") return "needs_review";
  if (PO_STATUS_MAP[key]) return "approved";
  return "needs_review";
}