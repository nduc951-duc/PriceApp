import js from "@eslint/js";
import parser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { Buffer: "readonly", process: "readonly", URL: "readonly", NodeJS: "readonly", fetch: "readonly", Response: "readonly", AbortSignal: "readonly", setTimeout: "readonly" },
    },
    rules: { "no-unused-vars": "off" },
  },
];
