"use client";

import { Dialog, DialogTrigger } from "@eylulg/ui/dialog";
import { Button } from "react-aria-components";
import { CHIP_CLASS } from "@/components/styles";
import { citationLabel } from "@/lib/chat/citations";
import type { Citation } from "@/lib/protocol";
import { SourceViewer } from "./source-viewer";

/** A numbered chip. Activating it opens the cited document at the cited range, and closing the viewer returns focus here. */
export function CitationChip({ number, citation }: { number: number; citation: Citation }) {
    const label = citationLabel(number, citation);

    return (
        <DialogTrigger>
            <Button className={CHIP_CLASS} aria-label={label}>
                {number}
            </Button>
            <Dialog title={label} size="lg">
                <SourceViewer citation={citation} />
            </Dialog>
        </DialogTrigger>
    );
}
