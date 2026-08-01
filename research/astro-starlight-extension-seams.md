# Astro/Starlight extension seams: final routes and static LLM artifacts

**Scope.** Research only. Sources below are official Astro/Starlight documentation or source at pinned release commits. “Supported” means documented public API; source observations explain behavior, not extra API commitments.

## Decision

Use one **Starlight plugin** whose `config:setup` calls `addIntegration()` with one **Astro integration**. In that integration, use `astro:build:done`:

- `pages` is Astro’s final generated-page list, with `pathname` values.
- `dir` is output directory URL.
- Emit `llms.txt` at `dir`, then emit Markdown under directories derived from each selected `pathname`.

This is only documented seam that provides final generated paths and writable final build output in same lifecycle event. Do not implement a custom route scanner or rely on Starlight internals.

## Supported API chain

| Need | Supported seam | Evidence |
| --- | --- | --- |
| Install Starlight-aware extension | `starlight({ plugins: [...] })`; plugin object has `name` and hooks | [Starlight plugin reference](https://starlight.astro.build/reference/plugins/) |
| Add Astro lifecycle work from plugin | `config:setup({ addIntegration })` accepts an `AstroIntegration` | [Starlight plugin reference](https://starlight.astro.build/reference/plugins/) |
| Observe final generated paths + output root | Astro `astro:build:done({ pages, dir, assets, logger })`; each `pages` entry exposes `pathname` | [Astro integrations reference — `astro:build:done`](https://docs.astro.build/en/reference/integrations-reference/#astrobuilddone) |
| Write static artifacts | Node built-in `node:fs/promises` writes beneath `dir` after page generation | Astro hook provides `dir`; Node filesystem is platform API. No dependency needed. |

`astro:build:generated({ dir })` is earlier and does **not** expose `pages`; it cannot authoritatively discover final paths. `astro:routes:resolved({ routes })` is also earlier: it resolves route definitions, not generated static paths. [Astro integrations reference](https://docs.astro.build/en/reference/integrations-reference/)

Starlight itself runs plugin setup during its `astro:config:setup`, injects its `[...slug]` route there, and adds plugin-requested Astro integrations immediately after Starlight. That supports plugin → Astro integration composition, but is implementation detail, not route-discovery API. [Starlight 0.41.6 integration source](https://github.com/withastro/starlight/blob/ae0838f7817e02e88d5e721bffedbd1153e93d58/packages/starlight/index.ts#L43-L166)

## Route discovery boundary

**Fact:** Astro `build:done.pages` is final page output list. Its `pathname` is route pathname, not URL string and not filesystem path. [Astro integrations reference](https://docs.astro.build/en/reference/integrations-reference/#astrobuilddone)

**Fact:** Starlight public plugin hooks expose config, Astro config, integration installation, route middleware, translations, and locale helpers; they do **not** expose a final Starlight-document route list. [Starlight plugin reference](https://starlight.astro.build/reference/plugins/)

**Conclusion:** No supported Starlight API identifies *which* final Astro pages came from Starlight content. For this repository, whose docs are served through Starlight catch-all route, `pages` is sufficient after explicitly excluding outputs not intended for LLM artifacts (notably `/404`). A reusable plugin must document its selection rule or accept an explicit predicate/configuration. It must not infer Starlight ownership from private virtual modules, injected route entries, or output HTML.

Use `pages`, not source filenames or content-collection entries, for artifact paths. Source entries cannot represent redirects, static paths created by `getStaticPaths()`, route middleware effects, or build-time exclusions. `pages` represents build result.

## Lifecycle and artifact algorithm

1. In Starlight plugin `config:setup`, call `addIntegration(llmsIntegration)`. This runs during Astro config setup. [Starlight plugin reference](https://starlight.astro.build/reference/plugins/)
2. In `astro:build:done`, validate every selected `pathname` as a URL pathname before mapping it to disk: reject traversal, decode carefully, and never allow output outside `dir`.
3. Normalize selected pathnames once; construct public links from normalized pathnames and Astro `site`/`base` configuration. Create `llms.txt` in `dir`.
4. For each selected page, write companion Markdown under its equivalent output subtree (for example, `/reports/x/` → `reports/x/index.md` in directory-style builds). Create parents recursively with `mkdir({ recursive: true })`.
5. Keep conversion/rendering separate from route discovery. Build hook determines final names; page-content extraction is product logic and must define how Markdown source, MDX, or rendered HTML becomes `.md`.

`build:done` also runs for server output and reports generated pages, but a server deployment may not serve files written in client output directory. Require static output/prerendering for static artifact delivery, or add adapter-specific deployment support. [Astro configuration reference — `output`](https://docs.astro.build/en/reference/configuration-reference/#output)

## URL and output mapping constraints

### `base`

Astro `base` is site subpath. Final URL links in `llms.txt` must include it; output-relative paths must not duplicate it. Current project config has `base: '/starlight-llms-tree'`, so public link shape is `https://tigorlazuardi.github.io/starlight-llms-tree/<route>`. [Astro configuration reference — `base`](https://docs.astro.build/en/reference/configuration-reference/#base); [current config](../docs/astro.config.mjs).

Use Astro’s resolved config supplied to integration setup/config-done, not ad-hoc string concatenation. `site` may be unset; then emit path-only links or fail validation if absolute URLs are required. [Astro configuration reference — `site`](https://docs.astro.build/en/reference/configuration-reference/#site)

### i18n

Starlight’s `locales` maps locale keys to content directories; `defaultLocale` controls default language. A `root` locale allows default-language routes without locale prefix, while non-root locales appear prefixed (for example `/fr/...`). Therefore preserve each final pathname from `pages` rather than reconstructing locale prefixes. [Starlight configuration reference — `locales` and `defaultLocale`](https://starlight.astro.build/reference/configuration/#locales).

Astro i18n routing settings can additionally change prefix/fallback behavior. Treat final page pathname as source of truth. [Astro i18n routing guide](https://docs.astro.build/en/guides/internationalization/)

### `trailingSlash` and build format

Do not append or strip slash by hand. Astro config’s `trailingSlash` controls route URLs; `build.format` controls whether output is directory (`directory`) or file (`file`) style. Map output from `dir` and actual generated convention, while preserve hook `pathname` for public URL. [Astro configuration reference — `trailingSlash`](https://docs.astro.build/en/reference/configuration-reference/#trailingslash); [Astro configuration reference — `build.format`](https://docs.astro.build/en/reference/configuration-reference/#buildformat).

For recursive `.md`, an intentionally fixed mapping is acceptable only if plugin declares support for `build.format: 'directory'`; otherwise branch on resolved format. `pathname` `/` needs explicit `index.md` handling. Never derive disk path by `path.join(dir, pathname)` without validation: an absolute second argument can escape intended root.

## Version evidence

Current lockfile resolves **Astro 7.1.6** and **`@astrojs/starlight` 0.41.6**. Starlight 0.41.6 declares peer compatibility `astro: ^7.0.2`; project manifest declares the same ranges. [package lock](../docs/package-lock.json); [package manifest](../docs/package.json).

`astro:build:done` documented shape (`pages`, `dir`, `assets`, `logger`) and Starlight `config:setup.addIntegration` are available in this resolved pair. Pin implementation test matrix to Astro `>=7.0.2 <8` plus Starlight `>=0.41.6 <0.42` until verified against newer releases; this is a conservative project constraint, **not** an upstream compatibility guarantee. The source citation is pinned Starlight 0.41.6 release commit `ae0838f7817e02e88d5e721bffedbd1153e93d58`; release tag: [`@astrojs/starlight@0.41.6`](https://github.com/withastro/starlight/releases/tag/%40astrojs%2Fstarlight%400.41.6).

## Recommended acceptance checks for later implementation

- Build current fixture; assert `dist/llms.txt` exists.
- Assert one `.md` per selected `build:done.pages` pathname, including root and nested route.
- Assert each `llms.txt` link contains `/starlight-llms-tree/` once.
- Add multilingual fixture with `root` and `fr`; assert root and `/fr/` artifacts/links.
- Run same fixture with both supported trailing-slash settings and both build formats, or explicitly reject unsupported format with clear config error.
- Assert `/404` and non-Starlight Astro pages follow declared selection policy.

## Risks deliberately left to implementation

- Final route list does not identify Starlight ownership; selection policy is required for generic plugin.
- `pages` gives paths, not document text. Markdown generation needs defined source/render strategy.
- Files written at `build:done` need deployment verification for non-static adapters.
- Generated Markdown may expose draft/private content if selection policy ignores Starlight visibility rules. Validate at trust boundary.
