"use client";

import { Button } from "@/components/ui/button";

export function PrintReportButton() {
  return <><Button className="report-no-print" variant="outline" type="button" onClick={() => {
    document.querySelectorAll<HTMLDetailsElement>(".kagu-print-report details").forEach((item) => { item.open = true; });
    window.print();
  }}>Yazdır / PDF olarak kaydet</Button><style>{`@media print { @page { size: A4 landscape; margin: 12mm; } body * { visibility: hidden; } .kagu-print-report, .kagu-print-report * { visibility: visible; } .kagu-print-report { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 0 !important; } .report-no-print { display: none !important; } .kagu-print-report .overflow-x-auto { overflow: visible; } .kagu-print-report table { min-width: 0; font-size: 9px; } .kagu-print-report th, .kagu-print-report td { padding: 4px; } .kagu-print-report tr { break-inside: avoid; } .kagu-print-report thead { display: table-header-group; } .kagu-print-report details > * { display: block; } .kagu-print-report a { text-decoration: none; } }`}</style></>;
}
