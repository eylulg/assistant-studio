import { z } from "zod";
import { type Task, defineTool, prioritySchema } from "./types";

function nextId(tasks: readonly Task[]): string {
    const highest = tasks.reduce((max, task) => Math.max(max, Number(task.id.replace("task-", "")) || 0), 0);
    return `task-${highest + 1}`;
}

const createTaskInputSchema = z.object({
    title: z.string().trim().min(1).max(120).describe("Short imperative title"),
    due: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .optional()
        .describe("Due date as YYYY-MM-DD"),
    priority: prioritySchema.optional(),
});

export const createTask = defineTool({
    name: "create_task",
    description: "Add a task to the user's task list in the side panel. This changes the user's data, so the user must approve it first.",
    sideEffect: true,
    schema: createTaskInputSchema,
    run: ({ title, due, priority }, ctx) => {
        const created: Task = {
            id: nextId(ctx.tasks),
            title,
            ...(due ? { due } : {}),
            priority: priority ?? "normal",
            done: false,
            createdAt: ctx.now().toISOString(),
        };
        return { created };
    },
});

export const listTasks = defineTool({
    name: "list_tasks",
    description: "List the tasks in the user's task list.",
    sideEffect: false,
    schema: z.object({ status: z.enum(["open", "done", "all"]).optional().describe("Which tasks to list, all by default") }),
    run: ({ status }, ctx) => {
        const filter = status ?? "all";
        const tasks = ctx.tasks.filter((task) => filter === "all" || (filter === "done") === task.done);
        return { status: filter, count: tasks.length, tasks };
    },
});
