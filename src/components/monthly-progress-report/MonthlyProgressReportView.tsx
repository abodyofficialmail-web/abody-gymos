import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { Page1 } from "./Page1";
import { Page2 } from "./Page2";
import { Page3 } from "./Page3";
import { Page4 } from "./Page4";

export function MonthlyProgressReportView({ report }: { report: MonthlyProgressReport }) {
  return (
    <div className="monthly-progress-report space-y-6 bg-[#F3F1EC] py-6 print:space-y-0 print:bg-white print:py-0">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          .monthly-report-page { break-after: page; box-shadow: none !important; }
          .monthly-report-page:last-child { break-after: auto; }
        }
      `}</style>
      <Page1 report={report} />
      <Page2 report={report} />
      <Page3 report={report} />
      <Page4 report={report} />
    </div>
  );
}

export { Page1, Page2, Page3, Page4 };
export * from "./ui";
export * from "./shared";
export * from "./charts";
