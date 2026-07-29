# @clinicpilot/config

Shared lint and TypeScript configuration so every workspace enforces the same
rules from one place.

## ESLint

```js
// apps/api/eslint.config.js
import { base } from "@clinicpilot/config/eslint/base";
export default base;
```

```js
// apps/web/eslint.config.js
import { react } from "@clinicpilot/config/eslint/react";
export default react;
```

## TypeScript

```jsonc
// packages/<name>/tsconfig.json
{ "extends": "@clinicpilot/config/tsconfig/base.json" }
```

`base.json` carries only the strictness flags. Module/target settings stay with
each workspace because `apps/api` is CommonJS (NestJS decorator emit) while
`apps/web` and `packages/*` are ESM.
