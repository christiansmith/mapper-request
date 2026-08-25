# Mapper Request

> Fetching and scraping for Mapper JS

## Background

Mapper JS evaluates mapping descriptors against source data. This package provides its `request` plugin: a descriptor keyword that fetches remote JSON, XML, or HTML during mapping. Responses are parsed by content type, and HTML can be scraped for linked data, meta tags, and selected elements. The package also exports its `parse`, `extract`, and `contentType` helpers for standalone use.

## Install

### JSR

```bash
deno add jsr:@christiansmith/mapper-request
```

### NPM

```bash
npm install @christiansmith/mapper-request
```

## Usage

Register the plugin on a Mapper instance:

```js
import Mapper from '@christiansmith/mapper-js'
import mapperRequest from '@christiansmith/mapper-request'

const mapper = new Mapper(mappings, {
  initializers: {},
  transformers: {},
  plugins: {
    request: mapperRequest.request
  }
})
```

A descriptor with a `request` keyword performs a fetch during mapping:

```yaml
request:
  origin: https://api.example.com
  pathname: /articles/{{id}}
  search:
    q: term
  headers:
    accept: application/json
```

The URL is `origin` plus `pathname` plus `search`. Pathname template variables like `{{id}}` are filled from the mapping options and URL encoded. `search` is a literal object or a mapping evaluated against the current context. `method` defaults to `GET`. A `body` mapping is evaluated and sent as JSON.

A `url` pointer reads a complete URL instead of building one. A bare pointer string reads from the output built by earlier mapping stages. A scoped object names where to read from:

```yaml
request:
  url:
    source: /URL
```

`url: { source: <pointer> }` resolves the URL from the value being mapped — the same value pathname templates and search params read — for mappings whose job is to fetch URLs that arrive as data, such as items of a batch each carrying its own URL. Three more scopes read from the evaluation context: `target` is the object this mapping is building (useful when an earlier step stored the URL on the item), `input` is the original document, and `output` is the result so far (`url: { output: <pointer> }` is the explicit spelling of the bare-string form). An object must name exactly one scope. The resolved URL is used verbatim. A deployment exposed to untrusted callers should hold a boundary at `checkUrl` or in its network egress rules — most often by refusing private, link-local, and loopback addresses, which guards the deployment's own network position without constraining which public sites a mapping may fetch.

Responses are parsed by content type. JSON returns as data. XML parses to JSON alongside the raw text. HTML is loaded with cheerio; linked data and meta tags are extracted, and a `scraper` descriptor selects elements by CSS selector.

## Configuration

The default `request` export is built with safe defaults. Build a configured instance with `createRequest`:

```js
const request = mapperRequest.createRequest({
  timeoutMs: 10000,
  allowHeaders: ['accept', 'x-api-key'],
  maxResponseBytes: 1048576,
  checkUrl: (url) => {
    // throw to refuse the destination
  }
})
```

| Option | Default | Effect |
| --- | --- | --- |
| `timeoutMs` | `10000` | Abort the request after this many milliseconds. The timeout covers the response body, not just the headers. |
| `redirect` | `'refuse'` | Redirect responses (301, 302, 303, 307, 308) are refused with an error naming the target. The only implemented mode. |
| `allowHeaders` | `true` | `true` forwards all descriptor headers. A list forwards only the named headers, case-insensitive. |
| `checkUrl` | none | Called with the resolved URL before any connection. Throw to refuse. |
| `maxResponseBytes` | none | Reject response bodies larger than this many bytes. |

Policy is fixed when the plugin is constructed. Descriptors cannot change it. This matters in deployments where callers author their own mappings: configure `allowHeaders: []` there, and grant specific headers deliberately. Redirects are refused in every configuration because the upstream chooses the redirect target.

## Caching hooks

When the evaluation context provides `decache`, `encache`, or `throttle` plugins, the request plugin consults them: `decache` may answer from cache, `throttle` runs before the fetch, and `encache` stores the parsed result.

## Tests

```bash
deno task test
```

## License

MIT © Christian Smith
