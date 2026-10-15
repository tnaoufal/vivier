# @vivier/analysis

The pure part of the analysis, shared by the web app (through the
`@vivier/analysis` path alias, straight from `src/`) and the processor
(through a `file:` dependency, from `dist/`, built by the processor's
`npm run build:analysis`). Zero dependencies: no zod, no React, no `@/`
import, no DOM or Node global (the package carries no typings for them).
Each app keeps its own zod schemas for the model's answers and for the
stored JSON it reads. Tests sit next to the modules and run with the web
app's vitest.
