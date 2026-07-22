import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat ESLint config for all TypeScript packages. */
export default tseslint.config(
  { ignores: ["dist/**", ".next/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript resolves globals; no-undef false-positives on TS types.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  }
);
