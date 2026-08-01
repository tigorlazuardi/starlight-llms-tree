# Prototype: recursive `llms.txt` output

Question: which representative Markdown shape best balances branch discoverability and token cost while showing full tags on direct content and recursive scopes on child folders?

<!-- ponytail: Static Markdown replaces a switchable UI because Markdown is the product surface. Add rendered variants only if raw-text review cannot settle the shape. -->

## Verdict

Use separate `## Pages` and `## Folders` lists. Keep each link item compatible with the `link: description` convention. Put tags or scopes on one nested metadata line. List each route index as `Overview`, even though it also supplies folder title and description.

Omit `Pages` or `Folders` when its list is empty.

## Representative content tree

```text
/
├── index.mdx                         tags: product, product/core
├── changelog.mdx                     tags: releases/history
├── guides/
│   ├── index.mdx                     tags: guide, setup/basics
│   ├── install.mdx                   tags: setup/linux, setup/mac
│   ├── deploy.mdx                    tags: ops/cloud
│   └── advanced/
│       ├── index.mdx                 tags: advanced
│       ├── runtime.mdx               tags: performance/runtime
│       └── auth.mdx                  tags: security/auth
└── reference/
    └── api/
        └── endpoints.mdx             tags: api/http
```

## `/llms.txt`

```markdown
# Acme Docs

> Build and operate Acme products.

## Pages

- [Overview](/index.md): Acme documentation home.
  - Tags: `product`, `product/core`
- [Changelog](/changelog.md): Product changes by release.
  - Tags: `releases/history`

## Folders

- [Guides](/guides/llms.txt): Build and ship Acme apps.
  - Scopes: `advanced`, `guide`, `ops`, `performance`, `security`, `setup`
- [Reference](/reference/llms.txt)
  - Scopes: `api`
```

## `/guides/llms.txt`

```markdown
# Guides

> Build and ship Acme apps.

## Pages

- [Overview](/guides.md): Guides overview.
  - Tags: `guide`, `setup/basics`
- [Install](/guides/install.md): Install Acme on a workstation.
  - Tags: `setup/linux`, `setup/mac`
- [Deploy](/guides/deploy.md): Deploy Acme to cloud infrastructure.
  - Tags: `ops/cloud`

## Folders

- [Advanced](/guides/advanced/llms.txt): Advanced operating guides.
  - Scopes: `advanced`, `performance`, `security`
```

## `/guides/advanced/llms.txt`

```markdown
# Advanced

> Advanced operating guides.

## Pages

- [Overview](/guides/advanced.md): Advanced guides overview.
  - Tags: `advanced`
- [Runtime performance](/guides/advanced/runtime.md): Tune runtime performance.
  - Tags: `performance/runtime`
- [Authentication](/guides/advanced/auth.md): Configure authentication.
  - Tags: `security/auth`
```

## `/reference/llms.txt`

No route index exists, so title comes from humanizing route segment and description is omitted.

```markdown
# Reference

## Folders

- [Api](/reference/api/llms.txt)
  - Scopes: `api`
```

## `/reference/api/llms.txt`

```markdown
# Api

## Pages

- [Endpoints](/reference/api/endpoints.md): HTTP endpoint reference.
  - Tags: `api/http`
```

## Rejected shapes

- One `## Contents` list: saves one heading but makes page and branch links less scannable.
- One H2 per child folder: branch prominence grows heading and token count with tree width.
- Inline tag suffixes: blur authored description and machine-relevant metadata.
- Linked H1 instead of `Overview`: hides route-index content outside normal file lists.

## Deliberate non-decisions

`Define discovery, routing, and collision contract` owns canonical absolute/base-aware link form, ordering, URL escaping, and collision behavior. `Define Markdown normalization boundaries` owns title/description extraction and normalization details. This prototype fixes output hierarchy and metadata presentation only.
