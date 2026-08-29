import parser from "@typescript-eslint/parser";

export default [
  {
    files: ["extensions/**/*.ts", "tests/**/*.ts"],
    languageOptions: { parser },
    rules: {
      complexity: ["error", 10],
    },
  },
];
