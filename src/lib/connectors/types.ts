import type { CanonicalDataset, ConnectorType } from "@/lib/domain/model";

/** error = the row was rejected. warning = the row was accepted with a caveat. */
export type IssueSeverity = "error" | "warning";

export interface IngestionIssue {
  row: number;
  field: string;
  message: string;
  severity: IssueSeverity;
}

export interface IngestionStats {
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  warnings: number;
}

export interface ConnectorResult {
  dataset: CanonicalDataset;
  issues: IngestionIssue[];
  rowsParsed: number;
  stats: IngestionStats;
}

/**
 * Every data source implements this interface. CSV is the first connector;
 * Odoo / SAP / Dynamics / NetSuite / custom API connectors slot in here later
 * and emit the same CanonicalDataset.
 */
export interface Connector<TInput> {
  type: ConnectorType;
  label: string;
  parse(input: TInput): ConnectorResult;
}

export const CONNECTOR_CATALOGUE: {
  type: ConnectorType;
  label: string;
  status: "available" | "planned";
  description: string;
}[] = [
  {
    type: "csv",
    label: "CSV upload",
    status: "available",
    description: "Upload an inventory & sales extract from any system.",
  },
  { type: "odoo", label: "Odoo", status: "planned", description: "Direct sync of products, stock and sales orders." },
  { type: "sap", label: "SAP", status: "planned", description: "Material master, stock and consumption history." },
  { type: "dynamics", label: "Microsoft Dynamics", status: "planned", description: "Items, on-hand and sales lines." },
  { type: "netsuite", label: "NetSuite", status: "planned", description: "Item records, inventory and transactions." },
  { type: "custom_api", label: "Custom API", status: "planned", description: "Map any REST source to the canonical model." },
];