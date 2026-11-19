import type { Metadata } from "next";
import { Insights } from "@/components/insights/insights";
import { loadReports } from "@/lib/insights/load-reports";

export const metadata: Metadata = {
    title: "Insights | Assistant Studio",
    description: "Usage from your own conversations in this browser, and the results of the eval suite.",
};

export default function Page() {
    return <Insights reports={loadReports()} />;
}
