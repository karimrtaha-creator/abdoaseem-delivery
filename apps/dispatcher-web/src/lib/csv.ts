// Shared by every CSV export screen (Dashboard's daily report,
// VoucherManagement's usage report, ...) so the formula-injection guard
// (Finding #005, security audit) lives in exactly one place.
function csvEscape(value: string | number | boolean | null): string {
  let str = value == null ? "" : String(value);
  // Finding #005 (security audit): a STRING value starting with =, +, -,
  // or @ opens a formula when this export is later opened in Excel/Sheets
  // (CSV formula injection) - e.g. a branch/status/payment-method field
  // of '=cmd|"/c calc"!A1' would execute on open. A leading apostrophe
  // forces spreadsheet apps to treat the cell as literal text. Only
  // applied to actual strings - numeric fields are machine-computed and
  // can legitimately be negative, so prefixing "-5" here would wrongly
  // turn a real number into text and break sorting/summing in Excel.
  if (typeof value === "string" && /^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function downloadCsv(filename: string, rows: (string | number | boolean | null)[][]) {
  // Leading BOM so Excel opens Arabic text as UTF-8 correctly instead of
  // guessing the wrong codepage and showing garbled characters.
  const csv = "﻿" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
