import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The codebase uses `any` deliberately in generic API adapters and in a
    // few places where the backend response shape is dynamic. Treat it as a
    // warning rather than a build-breaking error.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Idiomatic patterns (mounted flags, lazy client init) trigger this new
      // rule; keep them as warnings to avoid churning working code.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
]

export default eslintConfig
