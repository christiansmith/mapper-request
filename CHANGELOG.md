# Changelog

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
