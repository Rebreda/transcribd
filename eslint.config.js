// @ts-check
const tseslint = require("typescript-eslint");
const prettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = tseslint.config(
    {
        ignores: ["eslint.config.js", "_build/**", "build/**", "dist/**"],
    },
    ...tseslint.configs.recommendedTypeChecked,
    prettierRecommended,
    {
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: __dirname,
            },
        },
        rules: {
            "@typescript-eslint/restrict-template-expressions": [
                "error",
                { allowNullish: true },
            ],
        },
    },
);
