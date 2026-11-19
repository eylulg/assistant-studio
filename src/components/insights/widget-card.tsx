import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@eylulg/ui/card";
import { META_CLASS } from "@/components/styles";

interface WidgetCardProps {
    title: string;
    description?: string;
    children: ReactNode;
    /** A line under the chart for what the chart cannot say itself: what is left out, what is demo. */
    note?: ReactNode;
    className?: string;
}

/** The frame every chart sits in. The chart carries the same title as its accessible name and hides its own heading. */
export function WidgetCard({ title, description, children, note, className }: WidgetCardProps) {
    return (
        <Card className={className}>
            <CardHeader title={title} description={description} headingLevel={3} />
            <CardBody>{children}</CardBody>
            {note ? <p className={META_CLASS}>{note}</p> : null}
        </Card>
    );
}
