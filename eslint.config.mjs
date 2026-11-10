import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const config = [
    ...nextCoreWebVitals,
    ...nextTypescript,
    {
        ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
    },
    {
        rules: {
            ...jsxA11y.flatConfigs.recommended.rules,
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-non-null-assertion": "error",
            "react-hooks/exhaustive-deps": "error",
            "no-console": "error",
            "no-void": "error",
            "import/no-anonymous-default-export": "error",
        },
    },
    {
        // The fixture recorder and the eval reporter are command line tools; their output is the console.
        files: ["scripts/**", "evals/**"],
        rules: { "no-console": "off" },
    },
];

export default config;
