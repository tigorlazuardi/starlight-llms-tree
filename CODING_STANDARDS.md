# Coding Standards

## Formatting

TypeScript/JavaScript formatting and linting are enforced by Biome through root `biome.json`; MDX remains governed by `.pi/rules/docs-mdx-authoring.md`.

## Naming

- Use `camelCase` for functions, variables, and object fields; use `PascalCase` for types.
- Use kebab-case for implementation and test filenames. Keep package entry point named `index.ts`.
- Name tests after observable behavior, not internal function names.
- Use domain terms from spec: page, folder, route, scope, output manifest, normalization, and raw fallback. Do not introduce synonyms for these concepts.

## Modules and seams

- Keep root package export limited to named `starlightLlmsTree` factory and `StarlightLlmsTreeOptions` type.
- Keep implementation symbols internal unless spec requires public API. Do not add default exports, CommonJS entry points, CLI commands, subpath exports, factories, or interfaces for single implementations.
- Prefer Node standard library and installed dependencies. Add dependency only when equivalent correct implementation would be materially larger or less reliable.
- Keep Astro/Starlight lifecycle access at integration boundary. Keep deterministic route, tree, normalization, and manifest decisions independent from process-global state where practical.
- Treat final Astro pathname as route authority. Never reconstruct public routes from source filenames.
- Build and validate complete output manifest before any generated artifact write.

## Error handling and logging

- Throw typed or contextual `Error` instances for invalid configuration, unsafe paths, collisions, total generation failure, and write failure. Error messages name relevant route and target without including authored page content.
- Recoverable normalization failures follow selected mode: warn plus raw fallback by default; throw in strict mode.
- Never swallow errors. Catch only to add actionable context, perform declared fallback, or preserve all-or-nothing writes.
- Default logs contain warnings and errors only. Debug logs require `debug: true` or `STARLIGHT_LLMS_TREE_DEBUG=1`.
- Never log authored page bodies, credentials, environment values, or other content payloads.

## Testing

- Use Node `node:test`; do not add another test framework without a demonstrated missing capability.
- Primary acceptance seam is packed package installed into real Starlight fixture, followed by real static Astro build and assertions against output tree, content, logs, and exit status.
- Keep stable golden fixture deterministic. Add focused fixtures only when full fixture cannot isolate safety, configuration, or failure behavior.
- Test external behavior rather than private call structure. Unit-test pure path/collision/normalization edge logic only when integration failure would be ambiguous.
- Every bug fix adds one regression check at highest practical seam.
- Tests must prove no partial generated writes after manifest failure and no authored content in debug logs.

## Comments and documentation

- Public API declarations require concise doc comments describing behavior, defaults, and invalid combinations.
- Inline comments explain why a non-obvious constraint exists, not what code states.
- Mark deliberate simplifications with `ponytail:` plus known ceiling and upgrade trigger.
- Feature documentation uses repository Starlight MDX dialect and includes concrete input/output examples.

## Repository-specific prohibitions

- Do not emit development-server, SSR, or adapter runtime endpoints in v1.
- Do not add custom content roots, inclusion filters, output paths, title/tag/route/order policies, virtual tag indexes, runtime search, harness skills, or API-version options.
- Do not overwrite, merge, or suffix colliding output.
- Do not duplicate Astro `base` in disk paths.
- Do not merge locale trees or duplicate locale fallback pages.
- Do not add OpenTelemetry, metrics, traces, or info-level success logs.
- Do not widen supported Astro, Starlight, or Node ranges without compatibility evidence.

The Fowler smell baseline from the `code-review` skill still applies below these standards. Where this document and the baseline disagree, this document wins.

First ticket touching any codebase area sets its living pattern there. Later reviews check both this document and that first landed code; disagreement signals standards may need updating, not that code is wrong by default.
