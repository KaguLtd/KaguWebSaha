"use client";

import { Button } from "@/components/ui/button";

export function PrintReportButton() {
  return <><Button className="report-no-print" variant="outline" type="button" onClick={() => {
    // Prepare full rows before window.print; the browser's native beforeprint also handles Ctrl+P.
    window.dispatchEvent(new Event("beforeprint"));
    try { window.print(); } catch { window.dispatchEvent(new Event("afterprint")); }
  }}>Yazdır / PDF olarak kaydet</Button><style>{`
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
      body * { visibility: hidden; }
      .kagu-print-report, .kagu-print-report * { visibility: visible; }
      .kagu-print-report { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
      .report-no-print, .kagu-print-report .report-screen-table { display: none !important; }
      .kagu-print-report .report-print-only { display: block !important; }
      .kagu-print-report [data-report-section] { display: block !important; margin-top: 6mm; }
      .kagu-print-report .overflow-x-auto { overflow: visible; }
      .kagu-print-report .report-section { margin-top: 6mm; }
      .kagu-print-report h1, .kagu-print-report h2, .kagu-print-report h3, .kagu-print-report summary, .kagu-print-report caption { break-after: avoid; }
      .kagu-print-report table { width: 100%; min-width: 0; table-layout: auto; font-size: 9px; border-collapse: collapse; }
      .kagu-print-report th, .kagu-print-report td { padding: 4px; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; border-bottom: 1px solid #e2e8f0; }
      .kagu-print-report th { overflow-wrap: normal; white-space: normal; }
      .kagu-print-report [data-report-column="id"] { min-width: 14ch; width: 16ch; }
      .kagu-print-report [data-report-column="date"] { min-width: 11ch; width: 12ch; }
      .kagu-print-report [data-report-column="datetime"] { min-width: 18ch; width: 19ch; }
      .kagu-print-report td[data-report-column="date"], .kagu-print-report td[data-report-column="datetime"] { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .kagu-print-report [data-report-column="number"] { min-width: 7ch; width: 9ch; }
      .kagu-print-report [data-report-column="status"] { min-width: 12ch; overflow-wrap: normal; word-break: normal; }
      .kagu-print-report [data-report-column="text"], .kagu-print-report [data-report-column="source"] { min-width: 9ch; }
      .kagu-print-report [data-report-column="prose"] { min-width: 28ch; }
      .kagu-print-report thead { display: table-header-group; }
      .kagu-print-report tfoot { display: table-footer-group; }
      .kagu-print-report tbody, .kagu-print-report tr, .kagu-print-report details { break-inside: auto; }
      .kagu-print-report details > * { display: block; }
      .kagu-print-report a { text-decoration: none; }
      .kagu-print-report svg { max-height: 45mm; }
    }
  `}</style></>;
}
