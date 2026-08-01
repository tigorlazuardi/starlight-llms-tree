# LLM Markdown endpoint competitors

## Scope and method

Question: contracts, output formats, compatibility choices, limitations, and v1 conventions for `starlight-llms-tree`.

Only primary sources used: competitor maintained repositories and [llms.txt proposal](https://llmstxt.org/). Findings reflect current default branches when researched. “Recommendation” sections are inference, not competitor claims.

## Baseline: llms.txt proposal

`/llms.txt` is a Markdown index for LLM use. Required content is only one H1. In order after it, proposal permits: a short blockquote summary; non-heading explanatory Markdown; then zero or more H2 file-list sections. Each list item needs a Markdown link and may add `: description`. `## Optional` has semantic meaning: consumers may skip its links when context is short. Proposal also recommends clean per-page Markdown at original URL plus `.md`; for extensionless paths it says append `index.html.md`.[^spec-format][^spec-md]

Proposal does **not** define `llms-full.txt`, YAML frontmatter, grouping taxonomy, source-vs-rendered content, or an HTTP content type. Those are integration conventions, not spec compatibility requirements.

## Competitor comparison

| Package | Integration contract | Files / routes | Markdown source | Main compatibility choice | Important limit |
| --- | --- | --- | --- | --- | --- |
| [`starlight-llms-txt`](https://github.com/delucis/starlight-llms-txt) | Starlight plugin; requires Astro `site`; reads `docs` collection | prerendered `/llms.txt`, `/llms-full.txt`, `/llms-small.txt`, and `/_llms-txt/[slug].txt` custom subsets | Render docs/MDX to HTML then convert to GFM Markdown; optional raw body mode | Rich Starlight-aware aggregate documents, localized default locale only, page ordering controls | No individual page `.md` endpoint; aggregate can be large; raw mode preserves unrendered MDX |
| [`starlight-dot-md`](https://github.com/morinokami/starlight-dot-md) | Starlight plugin; reads `docs` collection | prerendered `/[...slug].md`; optional `.mdx` and `.mdoc` variants | `CollectionEntry.body` source; optional YAML serialization of `entry.data` | Raw source fidelity, Starlight trailing-slash-aware slug mapping, source extension preservation opt-in | No `llms.txt` or aggregate output; MDX/components remain source syntax; source scan assumes `src/content/docs` |
| [`astro-llms-md`](https://github.com/tfmurad/astro-llms-md) | Astro integration runs after build; needs `site` or `siteUrl` | writes `llms.txt`, `llms-full.txt`, and page `.md` files into build output | Parse rendered HTML; select `h1` and `main`; Turndown HTML → Markdown | Generic Astro/static-output support, canonical URL trailing-slash follows Astro build config | Build-time static output only; skips pages without title; selector/HTML conversion can lose semantics; writes build directory |

### `starlight-llms-txt`

**Contract and output.** Plugin injects four prerendered routes and rejects config without Astro `site`.[^starlight-routes] Its index emits project H1, optional blockquote and details, `## Documentation Sets` links to abridged/complete/custom aggregate files, `## Notes`, and optional `## Optional` links.[^starlight-index] This is structurally conformant with proposal ordering and gives `Optional` its specified skip meaning. Complete and abridged files are one concatenated document: each included page becomes `# page title`, optional blockquote description, then Markdown body; `llms-small.txt` can exclude slugs.[^starlight-generator]

**Compatibility choices.** Default locale only and non-draft docs only are included. Ordering is deterministic through `Intl.Collator`, with default `index*` promotion and configurable promote/demote glob lists.[^starlight-generator] Render-to-HTML then GFM conversion deliberately handles Starlight UI: asides, details, expressive-code language/diffs, tabs, file trees, and HTML comments. Small output removes note/tip asides, details, and collapses prose whitespace by default while preserving fenced-code newlines.[^starlight-conversion]

**Limits.** It produces discovery plus aggregates, not source-equivalent individual Markdown URLs. Rendering needs its MDX server renderer; `rawContent` avoids that pipeline but returns `entry.body`, so unrendered component syntax is possible.[^starlight-conversion] Default-locale-only behavior means translated content is absent from aggregate output.[^starlight-generator]

### `starlight-dot-md`

**Contract and output.** Plugin injects prerendered catch-all `.md` route. For each included, non-excluded docs entry it returns `text/markdown; charset=utf-8`; missing or filtered paths return 404.[^dot-md-route] Output is original collection body, either alone or prefixed by YAML generated from collection data. Options are `includePatterns`, `excludePatterns`, `includeFrontmatter` (default true), and `preserveExtension` (default false).[^dot-md-types][^dot-md-utils]

**Compatibility choices.** Its ordinary route maps Starlight slug to `<slug>.md`; when Astro/Starlight `trailingSlash: "always"`, non-index pages map to `<slug>/index.md`, matching output-page URL shape. With `preserveExtension`, `.md` endpoint excludes MDX/MDOC docs and dedicated `.mdx` / `.mdoc` routes expose their source extension instead.[^dot-md-index][^dot-md-utils] This is a source-delivery contract, not HTML-to-Markdown normalization.

**Limits.** It makes no `llms.txt` index or combined context. Raw `entry.body` means agents must understand MDX/MDOC syntax and any component imports/references; frontmatter is transformed collection data, not necessarily byte-for-byte source frontmatter.[^dot-md-utils] The extension scan uses `<project root>/src/content/docs`, so nonstandard content locations are not discovered for preserve-extension routing.[^dot-md-index]

### `astro-llms-md`

**Contract and output.** Integration records Astro config then, at `astro:build:done`, scans generated `*.html`, creates files in `dist`, and warns/returns without output if no `site`/`siteUrl` exists.[^astro-integration] Defaults enable page Markdown, `llms.txt`, and `llms-full.txt`; select page title from `h1`, content from `main`, and exclude error/assets/XML/TXT patterns.[^astro-options] Pages without a title are skipped.[^astro-generation]

**Format.** Each page Markdown starts YAML frontmatter (`title`, canonical `url`, optional `description`) then Turndown output. `llms.txt` has H1, optional quoted description, fixed prose, directory-derived H2 groups, and absolute links to page `.md` files. `llms-full.txt` has H1, site `URL:`, then each page as H2, page `URL:`, description, content, and `---` separators.[^astro-format]

**Compatibility choices.** HTML conversion uses ATX headings and fenced code blocks. `script`, `style`, and `[data-llms-ignore]` are always stripped; further selectors are configurable, while nav/aside/footer/form/hidden “noise” list is opt-in to avoid upgrade output changes.[^astro-generation][^astro-options] Canonical URLs honor Astro `trailingSlash`; `ignore` derives `always` for directory build format and `never` for file build format. `.md` links in index intentionally remain file URLs without a trailing slash.[^astro-trailing]

**Limits.** This is post-build static HTML extraction, not a Starlight collection route: dynamic/SSR-only pages not emitted as HTML cannot be discovered (inference from build-output glob). Nested content, HTML conversion, configured selectors, and absent `h1`/`main` alter or omit content. It logs per-file processing errors and continues, so successful build does not prove every page was converted.[^astro-generation]

## v1: preserve these conventions

1. **Ship spec-shaped discovery first.** Generate root `llms.txt` with one H1, optional blockquote/details, H2 file lists, descriptive links, and reserve exact `## Optional` semantics. Do not make `llms-full.txt` required for v1; proposal does not require it.[^spec-format]
2. **Ship per-page `*.md` routes.** This is proposal-recommended and missing from `starlight-llms-txt`; retain `text/markdown; charset=utf-8`, deterministic 404 for absent/filtered docs, include/exclude globs, and Starlight trailing-slash mapping from `starlight-dot-md`.[^spec-md][^dot-md-route][^dot-md-utils]
3. **Default to source Markdown for endpoint fidelity.** Preserve frontmatter option and document that MDX/MDOC is source syntax. Rendered HTML → Markdown is valuable later only when v1 explicitly supports component expansion; it costs conversion edge cases and selector policy.[^dot-md-utils][^starlight-conversion]
4. **Keep page order deterministic and home first.** This helps stable builds/diffs and mirrors `starlight-llms-txt` index promotion.[^starlight-generator]
5. **Expose only minimal filters.** Include/exclude patterns plus draft policy are enough. Do not add full/minified/custom aggregate sets until user demand; they are useful but separate aggregate-product scope.
6. **Honor Astro/Starlight canonical URL behavior.** `trailingSlash: "always"` must not produce broken per-page Markdown paths. Derive URLs from configured output shape, not string guesses.[^dot-md-utils][^astro-trailing]

## Deliberate non-goals for v1

- No `llms-full.txt`, abridged output, custom subsets, minification, or HTML-to-Markdown rendering.
- No claim that Markdown is byte-identical when frontmatter is normalized or an MDX document has imports/components.
- No speculative support for nonstandard content roots or dynamic runtime page conversion. Add only against confirmed Starlight/Astro requirements.

## Source notes

All links below are official maintained source or proposal pages. Source-code citations name exact behavior; package README claims are used only where source does not define user-facing option intent.

[^spec-format]: [llms.txt proposal — Format](https://llmstxt.org/#format)
[^spec-md]: [llms.txt proposal — Proposal](https://llmstxt.org/#proposal)
[^starlight-routes]: [`starlight-llms-txt` route injection and `site` requirement](https://github.com/delucis/starlight-llms-txt/blob/main/packages/starlight-llms-txt/index.ts)
[^starlight-index]: [`starlight-llms-txt` `/llms.txt` route](https://github.com/delucis/starlight-llms-txt/blob/main/packages/starlight-llms-txt/llms.txt.ts)
[^starlight-generator]: [`starlight-llms-txt` aggregate generator](https://github.com/delucis/starlight-llms-txt/blob/main/packages/starlight-llms-txt/generator.ts)
[^starlight-conversion]: [`starlight-llms-txt` HTML/MDX-to-Markdown conversion](https://github.com/delucis/starlight-llms-txt/blob/main/packages/starlight-llms-txt/entryToSimpleMarkdown.ts)
[^dot-md-route]: [`starlight-dot-md` `.md` endpoint](https://github.com/morinokami/starlight-dot-md/blob/main/packages/starlight-dot-md/src/slug.md.ts)
[^dot-md-types]: [`starlight-dot-md` option types](https://github.com/morinokami/starlight-dot-md/blob/main/packages/starlight-dot-md/src/types.ts)
[^dot-md-utils]: [`starlight-dot-md` output and URL utilities](https://github.com/morinokami/starlight-dot-md/blob/main/packages/starlight-dot-md/src/utils.ts)
[^dot-md-index]: [`starlight-dot-md` plugin and extension scan](https://github.com/morinokami/starlight-dot-md/blob/main/packages/starlight-dot-md/src/index.ts)
[^astro-integration]: [`astro-llms-md` Astro hooks](https://github.com/tfmurad/astro-llms-md/blob/main/src/index.ts#L494-L566)
[^astro-options]: [`astro-llms-md` options and documented defaults](https://github.com/tfmurad/astro-llms-md/blob/main/README.md#configuration-options)
[^astro-generation]: [`astro-llms-md` discovery, extraction, and writing](https://github.com/tfmurad/astro-llms-md/blob/main/src/index.ts#L101-L170) and [generation loop](https://github.com/tfmurad/astro-llms-md/blob/main/src/index.ts#L300-L491)
[^astro-format]: [`astro-llms-md` formatters](https://github.com/tfmurad/astro-llms-md/blob/main/src/index.ts#L172-L298)
[^astro-trailing]: [`astro-llms-md` trailing-slash implementation](https://github.com/tfmurad/astro-llms-md/blob/main/src/index.ts#L74-L99) and [README behavior](https://github.com/tfmurad/astro-llms-md/blob/main/README.md#trailing-slash-on-emitted-urls)
