export function escapeCsvField(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

// Excel otherwise infers phone numbers as numeric values when opening a CSV.
export function toExcelText(value) {
  return `="${String(value ?? '').replaceAll('"', '""')}"`;
}
