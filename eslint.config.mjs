import { defineConfig } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([
    {
        ignores: [
            ".vite/**",
            "node_modules/**",
            "dist/**",
            "out/**",
            "publisher/**",
        ],
    },
    {
        extends: fixupConfigRules(compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/eslint-recommended",
            "plugin:@typescript-eslint/recommended",
        )),
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "import/no-unresolved": "off",
            "no-undef": "off",
            "@typescript-eslint/no-require-imports": "off",
        },

        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },

            parser: tsParser,
        },
    },
]);
