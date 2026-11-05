/** One table of a report, for the Excel download. */
export interface CsvTable {
  title: string;
  head: string[];
  rows: (string | number | null)[][];
}

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Downloads report tables as a .csv file, which Excel and Google Sheets open directly.
 * Tables are placed one under the other with their titles. The BOM makes Excel read ₹ and other symbols correctly.
 */
export function downloadCsv(fileName: string, heading: string, tables: CsvTable[]) {
  const lines = [cell(heading), ''];
  for (const t of tables) {
    lines.push(cell(t.title), t.head.map(cell).join(','));
    for (const r of t.rows) lines.push(r.map(cell).join(','));
    lines.push('');
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
