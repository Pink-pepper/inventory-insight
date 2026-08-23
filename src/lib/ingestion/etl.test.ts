import { describe, expect, test } from "bun:test";
import { profileSheet } from "./profile";
import { classifyWorkbook } from "./classify";
import { parseDate, parseNumber } from "./validate";
import { emptySheet, type SheetTable } from "./sheet-table";

function sheet(name: string, headers: string[], rows: string[][]): SheetTable {
  return { sheetName: name, headers, rows, rowCount: rows.length, truncated: false };
}

describe("column profiling", () => {
  test("detects types and identifier prefixes from values", () => {
    const s = sheet(
      "Data",
      ["Code", "When", "How many", "Note"],
      [
        ["SKU-0001", "23-Aug-26", "1250", "fast mover"],
        ["SKU-0002", "24-Aug-26", "(300)", "N/A"],
        ["SKU-0003", "2026-08-25", "1,250.50", "ok"],
      ],
    );
    const cols = profileSheet(s);
    expect(cols[0]!.type).toBe("identifier");
    expect(cols[0]!.idPrefix).toBe("SKU");
    expect(cols[1]!.type).toBe("date");
    expect(cols[2]!.type).toBe("number");
    expect(cols[3]!.type).toBe("text");
  });

  test("empty columns are typed empty", () => {
    const s = sheet("S", ["A", "B"], [["x", ""], ["y", "-"]]);
    const cols = profileSheet(s);
    expect(cols[1]!.type).toBe("empty");
  });
});

describe("normalisation", () => {
  test("parses currency symbols, thousands separators and accounting negatives", () => {
    expect(parseNumber("₦1,250").value).toBe(1250);
    expect(parseNumber("$2,500.75").value).toBe(2500.75);
    expect(parseNumber("(300)").value).toBe(-300);
    expect(parseNumber("abc").malformed).toBe(true);
  });

  test("missing tokens are absent, not malformed", () => {
    for (const token of ["N/A", "-", "unknown", "none"]) {
      expect(parseNumber(token)).toEqual({ value: null, malformed: false });
      expect(parseDate(token)).toBeNull();
    }
  });

  test("parses written and day-first dates", () => {
    expect(parseDate("23-Aug-26")).toBe("2026-08-23");
    expect(parseDate("23 Aug 2026")).toBe("2026-08-23");
    expect(parseDate("23/08/2026")).toBe("2026-08-23");
    expect(parseDate("2026-08-23")).toBe("2026-08-23");
    expect(parseDate("not a date")).toBeNull();
  });
});

const MASTER_HEADERS = ["SKU", "Product Name", "Category", "Unit Cost"];
const MASTER_ROWS = [
  ["SKU-0001", "Widget A", "Hardware", "10.5"],
  ["SKU-0002", "Widget B", "Hardware", "20"],
  ["SKU-0003", "Widget C", "Electrical", "7.25"],
];
const CUSTOMER_HEADERS = ["Customer Ref", "Customer Name", "Segment"];
const CUSTOMER_ROWS = [
  ["CUS-001", "Acme Retail", "Gold"],
  ["CUS-002", "Beta Wholesale", "Silver"],
  ["CUS-003", "Gamma Stores", "Gold"],
];
const TX_HEADERS = ["Invoice No.", "Invoice Date", "Customer Code", "SKU", "Quantity", "Line Value"];
const TX_ROWS = [
  ["INV-1", "2026-08-23", "CUS-001", "SKU-0001", "5", "100"],
  ["INV-2", "2026-08-24", "CUS-002", "SKU-0002", "3", "75"],
  ["INV-3", "2026-08-25", "CUS-003", "SKU-0001", "2", "40"],
];

describe("workbook classification", () => {
  test("a sheet named 'Data' with date and quantity columns is recognised as transactions", () => {
    const analysis = classifyWorkbook([
      sheet("Products", MASTER_HEADERS, MASTER_ROWS),
      sheet("Data", TX_HEADERS, TX_ROWS),
    ]);
    const data = analysis.sheets.find((s) => s.sheetName === "Data")!;
    expect(data.kind).toBe("transactions");
    expect(data.role).toBe("transactional");
    expect(data.mapping.transaction_date).toBe(1);
    expect(data.mapping.quantity).toBe(4);
  });

  test("identifier columns are linked across sheets by value overlap", () => {
    const analysis = classifyWorkbook([
      sheet("Products", MASTER_HEADERS, MASTER_ROWS),
      sheet("Customers", CUSTOMER_HEADERS, CUSTOMER_ROWS),
      sheet("Data", ["Ref", "When", "Amount"], [
        ["CUS-001", "2026-08-01", "10"],
        ["CUS-002", "2026-08-02", "20"],
        ["CUS-003", "2026-08-03", "30"],
      ]),
    ]);
    const data = analysis.sheets.find((s) => s.sheetName === "Data")!;
    expect(data.mapping.customer_ref).toBe(0);
    expect(data.relationships.length).toBeGreaterThan(0);
  });

  test("masters and contextual sheets get the right roles and dispositions", () => {
    const analysis = classifyWorkbook([
      sheet("Products", MASTER_HEADERS, MASTER_ROWS),
      sheet("Company Info", ["Field", "Value"], [["Company", "Acme"], ["Year", "2026"]]),
    ]);
    const products = analysis.sheets.find((s) => s.sheetName === "Products")!;
    expect(products.kind).toBe("products");
    expect(products.role).toBe("master");
    expect(products.disposition).toBe("auto");
    const info = analysis.sheets.find((s) => s.sheetName === "Company Info")!;
    expect(info.kind).toBe("ignored");
    expect(info.disposition).toBe("ignored");
    expect(info.role === "contextual" || info.role === "unknown").toBe(true);
  });

  test("monthly sheets overlapping transaction data are flagged as duplicate sources", () => {
    const analysis = classifyWorkbook([
      sheet("Products", MASTER_HEADERS, MASTER_ROWS),
      sheet("Sales", ["SKU", "Invoice Date", "Quantity"], [
        ["SKU-0001", "2026-08-05", "4"],
        ["SKU-0002", "2026-08-09", "2"],
        ["SKU-0003", "2026-08-11", "9"],
        ["SKU-0001", "2026-09-02", "1"],
      ]),
      sheet("Monthly Sales", ["SKU", "Month", "Units Sold"], [
        ["SKU-0001", "2026-08-01", "4"],
        ["SKU-0002", "2026-08-01", "2"],
        ["SKU-0003", "2026-08-01", "9"],
        ["SKU-0001", "2026-09-01", "1"],
      ]),
    ]);
    const monthly = analysis.sheets.find((s) => s.sheetName === "Monthly Sales")!;
    expect(monthly.kind).toBe("sales_monthly");
    expect(monthly.duplicateSource).toBe("Sales");
    expect(monthly.disposition).toBe("review");
  });

  test("incomplete sheets are blocked with the missing fields listed", () => {
    const analysis = classifyWorkbook([
      sheet("Stock", ["SKU", "On Hand", "Mystery"], [
        ["SKU-0001", "10", "x"],
        ["SKU-0002", "5", "y"],
      ]),
    ]);
    const stock = analysis.sheets[0]!;
    expect(stock.kind).toBe("inventory");
    expect(stock.disposition).toBe("auto");
  });

  test("summary and entity preview aggregate across sheets", () => {
    const analysis = classifyWorkbook([
      sheet("Products", MASTER_HEADERS, MASTER_ROWS),
      sheet("Customers", CUSTOMER_HEADERS, CUSTOMER_ROWS),
      sheet("Data", TX_HEADERS, TX_ROWS),
      sheet("Notes", ["Thoughts"], [["nothing structured here"]]),
    ]);
    expect(analysis.summary.total).toBe(4);
    const productEntity = analysis.entities.find((e) => e.kind === "products");
    expect(productEntity?.records).toBe(3);
  });

  test("empty sheets never crash classification", () => {
    const analysis = classifyWorkbook([emptySheet("Empty")]);
    expect(analysis.sheets[0]!.disposition).toBe("ignored");
  });
});
