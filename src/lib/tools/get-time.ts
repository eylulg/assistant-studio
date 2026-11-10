import { z } from "zod";
import { ToolError, defineTool } from "./types";

export const getTime = defineTool({
    name: "get_time",
    description: "Get the current date and time in an IANA time zone such as Europe/Amsterdam, Asia/Tokyo or America/New_York.",
    sideEffect: false,
    schema: z.object({ timezone: z.string().min(1).max(60).describe("IANA time zone name") }),
    run: ({ timezone }, ctx) => {
        let formatter: Intl.DateTimeFormat;
        try {
            formatter = new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                weekday: "long",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
                timeZoneName: "longOffset",
            });
        } catch {
            throw new ToolError(`"${timezone}" is not an IANA time zone. Use a name like Europe/Oslo.`);
        }

        const parts = Object.fromEntries(formatter.formatToParts(ctx.now()).map((part) => [part.type, part.value]));
        const offset = parts.timeZoneName === "GMT" ? "+00:00" : (parts.timeZoneName ?? "").replace("GMT", "");
        return {
            timezone,
            weekday: parts.weekday,
            date: `${parts.year}-${parts.month}-${parts.day}`,
            time: `${parts.hour}:${parts.minute}:${parts.second}`,
            utcOffset: offset,
            clock: ctx.clock === "frozen" ? "Frozen demo clock, not the real time" : "System clock",
        };
    },
});
