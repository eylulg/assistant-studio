import { z } from "zod";
import { ToolError, defineTool } from "./types";

type Token = { kind: "number"; value: number } | { kind: "name"; value: string } | { kind: "op"; value: string };

const FUNCTIONS = new Map<string, (...args: number[]) => number>(
    Object.entries({
        sqrt: Math.sqrt,
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        ln: Math.log,
        log: Math.log10,
        exp: Math.exp,
        min: Math.min,
        max: Math.max,
    }),
);

const CONSTANTS = new Map([
    ["pi", Math.PI],
    ["e", Math.E],
]);
const MAX_LENGTH = 200;
const MAX_DEPTH = 40;

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    const pattern = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([a-z]+)|([-+*/^%(),]))/iy;
    let index = 0;
    while (index < source.length) {
        pattern.lastIndex = index;
        const match = pattern.exec(source);
        if (!match) {
            if (source.slice(index).trim() === "") break;
            throw new ToolError(`Unexpected character "${source.slice(index).trim().charAt(0)}" in the expression.`);
        }
        index = pattern.lastIndex;
        if (match[1] !== undefined) tokens.push({ kind: "number", value: Number(match[1]) });
        else if (match[2] !== undefined) tokens.push({ kind: "name", value: match[2].toLowerCase() });
        else if (match[3] !== undefined) tokens.push({ kind: "op", value: match[3] });
    }
    return tokens;
}

/** Recursive descent over + - * / % ^, parentheses, a few functions and constants. Nothing is ever passed to eval. */
function evaluate(tokens: Token[]): number {
    let position = 0;

    const peek = () => tokens[position];
    const isOp = (value: string) => {
        const token = peek();
        return token?.kind === "op" && token.value === value;
    };
    const expectOp = (value: string) => {
        if (!isOp(value)) throw new ToolError(`Expected "${value}" in the expression.`);
        position += 1;
    };

    function expression(depth: number): number {
        if (depth > MAX_DEPTH) throw new ToolError("The expression is nested too deeply.");
        let value = term(depth);
        while (isOp("+") || isOp("-")) {
            const operator = tokens[position++];
            const right = term(depth);
            value = operator?.value === "+" ? value + right : value - right;
        }
        return value;
    }

    function term(depth: number): number {
        let value = unary(depth);
        while (isOp("*") || isOp("/") || isOp("%")) {
            const operator = tokens[position++]?.value;
            const right = unary(depth);
            if ((operator === "/" || operator === "%") && right === 0) throw new ToolError("Division by zero.");
            value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
        }
        return value;
    }

    function unary(depth: number): number {
        if (isOp("-")) {
            position += 1;
            return -unary(depth + 1);
        }
        if (isOp("+")) {
            position += 1;
            return unary(depth + 1);
        }
        return power(depth);
    }

    function power(depth: number): number {
        const base = primary(depth);
        if (!isOp("^")) return base;
        position += 1;
        return base ** unary(depth + 1);
    }

    function primary(depth: number): number {
        const token = tokens[position++];
        if (!token) throw new ToolError("The expression ends too early.");
        if (token.kind === "number") return token.value;
        if (token.kind === "op" && token.value === "(") {
            const value = expression(depth + 1);
            expectOp(")");
            return value;
        }
        if (token.kind === "name") {
            const constant = CONSTANTS.get(token.value);
            if (constant !== undefined && !isOp("(")) return constant;
            const fn = FUNCTIONS.get(token.value);
            if (!fn) throw new ToolError(`Unknown name "${token.value}". Supported functions: ${[...FUNCTIONS.keys()].join(", ")}; constants: pi, e.`);
            expectOp("(");
            const args: number[] = [expression(depth + 1)];
            while (isOp(",")) {
                position += 1;
                args.push(expression(depth + 1));
            }
            expectOp(")");
            return fn(...args);
        }
        throw new ToolError(`Unexpected "${token.value}" in the expression.`);
    }

    const result = expression(0);
    if (position < tokens.length) throw new ToolError(`Unexpected "${tokens[position]?.value}" in the expression.`);
    return result;
}

export const calculate = defineTool({
    name: "calculate",
    description:
        "Evaluate an arithmetic expression exactly instead of estimating. Supports + - * / % ^, parentheses, sqrt, abs, round, floor, ceil, sin, cos, tan, ln, log, exp, min, max and the constants pi and e.",
    sideEffect: false,
    schema: z.object({ expression: z.string().min(1).max(MAX_LENGTH).describe("For example (12.5 * 8) / 4 + sqrt(81)") }),
    run: ({ expression }) => {
        const result = evaluate(tokenize(expression));
        if (!Number.isFinite(result)) throw new ToolError("The result is not a finite number.");
        return { expression, result: Number(result.toPrecision(12)) };
    },
});
