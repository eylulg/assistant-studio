"use client";

import { ProjectSwitcher, ThemeToggle, TopNav } from "@eylulg/ui/chrome";
import Link from "next/link";

export function Nav() {
    return (
        <TopNav
            productName="Assistant Studio"
            LinkComponent={Link}
            actions={
                <>
                    <ProjectSwitcher currentId="assistant-studio" />
                    <ThemeToggle />
                </>
            }
            compactActions={<ThemeToggle compact />}
        />
    );
}
