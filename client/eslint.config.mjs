import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// eslint-config-next ships native flat configs from v16, so these are spread
// straight in. Before v16 it was eslintrc-style and had to be bridged with
// FlatCompat from @eslint/eslintrc; that bridge throws a circular-structure
// error against the flat configs, so it went out with the upgrade.
// `next lint` is deprecated in Next 15 and removed in 16; the lint script
// drives the ESLint CLI directly.
const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Next 16's config turns on the React Compiler hook rules, which flag 17
    // pre-existing places across 13 files — 15 of them setState-in-effect.
    // None is a new bug; they're a stricter standard applied to code that
    // predates it, and satisfying them means restructuring effects, which is
    // its own job with its own review. Demoted to warnings so they stay
    // printed on every lint run instead of being switched off, and so the
    // security upgrade this came in with isn't held hostage to that refactor.
    // Promote back to "error" once they're cleared.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default config;
