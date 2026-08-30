import parser from "@typescript-eslint/parser";

export default [
  {
    files: ["extensions/**/*.ts", "tests/**/*.ts", "benchmarks/**/*.mjs"],
    languageOptions: { parser },
    rules: {
      complexity: ["error", 10],
    },
  },
];
