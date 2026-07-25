import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
<<<<<<< HEAD
      // A React 19 server action's signature is fixed: (previousState, formData).
      // Actions that read neither still have to declare both, and every such
      // parameter across the admin actions is written `_previous` / `_formData`.
      // Honour that convention rather than carrying fifteen standing warnings
      // that train everyone to ignore the lint output.
      "@typescript-eslint/no-unused-vars": [
        "warn",
=======
      // A React `useActionState` action is handed (previousState, formData)
      // whether it wants them or not, so a positional parameter it does not
      // read cannot simply be removed. The leading underscore is the signal
      // that it is unused on purpose; without this the codebase would either
      // carry permanent warnings or grow eslint-disable comments that suppress
      // genuine findings alongside these.
      "@typescript-eslint/no-unused-vars": [
        "error",
>>>>>>> c6e37a5734f287d0afb3f54a476fe6c0a2537a19
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
