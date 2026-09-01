# Changelog

## 0.4.0 (unreleased)

### Added

- `redirect: 'follow'` enables bounded redirect following as an opt-in deployment policy; refusal remains the default. Following is limited to GET requests and at most `maxRedirects` hops (default 2), every redirect target re-passes `checkUrl` before it is fetched so destination policy holds across a chain, and one timeout spans the whole chain. This makes hosts that 301-canonicalize their URLs (most commonly to a trailing-slash form) resolvable without conceding the refusal default.
- `redirectSameOrigin` (default `true`) names the constraint that followed redirects stay on the same origin. Only `true` is implemented; cross-origin targets are refused.
- `redirectHttpsUpgrade` (default `true`) additionally allows following an http→https redirect to the identical hostname on default ports — the scheme-upgrade redirect endemic on the open web. Set it `false` to require strict same-origin. The downgrade direction (https→http) is never followed under any configuration.

### Changed

- A refused redirect now throws a typed error carrying `code: 'E_REDIRECT_REFUSED'`, the response `status`, and the `location` target when present, so consuming services can classify a refusal as a policy outcome rather than an internal fault. The error message is unchanged.

### Added

- `url` accepts a scoped object form naming exactly one of four scopes. `{ source: <JSON Pointer> }` resolves the request URL from the value being mapped, so a mapping can fetch a URL that arrives as data. `{ target: … }`, `{ input: … }`, and `{ output: … }` read from the object being built, the original input, and the output so far; a bare pointer string still reads from the output, unchanged. The resolved URL is used verbatim — deployments exposed to untrusted callers should hold a boundary at `checkUrl` or in network egress rules, typically refusing private address ranges.

## 0.2.0 (2026-08-24)

### Added

- `createRequest(config)` builds a request plugin with policy fixed at construction time. The default export is the factory's safe-defaults instance, so existing imports keep working.
- `timeoutMs` aborts a request after a configurable timeout, default 10 seconds. The abort covers the response body as well as the headers, so a stalled body cannot outlive the timeout.
- `allowHeaders` makes descriptor header forwarding a deployment decision: `true` forwards all headers, a list forwards only the named ones.
- `checkUrl(url)` runs before any connection as a destination policy hook.
- `maxResponseBytes` caps the size of fetched response bodies.
- A request plugin test suite: golden request-construction tests and fixture-backed behavioral tests. Run with `deno task test`.

### Changed

- Redirect responses (301, 302, 303, 307, 308) are refused with an error naming the target. Previous versions followed redirects silently.
- Pathname template values are URL encoded.
- The mapper-js engine dependency moved from `^0.1.1` to `^0.3.1`.

## 0.1.3 (2026-06-04)

- Fixed the scraper `replace` keyword.

## 0.1.2 (2026-06-03)

- Import cheerio as a namespace; cheerio 1.0.0 dropped its default export.
- Excluded `package-lock.json` from the published package.

## 0.1.1 (2026-06-03)

- Added the mapper-js dependency to the manifest.
- Isolated search param mapping into a fresh target.

## 0.1.0 (2025-04-30)

- Initial release: the `request` plugin, JSON, XML, and HTML parsing, and HTML extraction helpers.
