/**
 * `import.meta.env`, declared as the optional thing it actually is here.
 *
 * Two shared modules read it — `data.ts` for the site's base path, `route.ts` for the same — and
 * both already guard with `?.` because they have to run outside a bundler: the unit tests and
 * the Playwright fixtures import them in plain node, where there is no `import.meta.env` at all.
 * This server is the third such caller and wants the same thing the others want.
 *
 * The alternative was `"types": ["vite/client"]`, which declares it as always present and drags
 * in a pile of browser ambient types on the way — so a server that has no DOM would typecheck as
 * though it had one. Optional is the truth, and it keeps the guards in those two files honest:
 * remove one and this is where it fails.
 */

interface ImportMeta {
  readonly env?: { readonly BASE_URL?: string } | undefined;
}
