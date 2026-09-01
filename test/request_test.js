/**
 * Tests for the request plugin.
 *
 *   deno test --allow-read --allow-env --allow-net=127.0.0.1 test/request_test.js
 *
 * Two sections:
 *
 * 1. Golden request construction — pins the exact URL, method, and body the
 *    plugin builds from a descriptor, including the engine-driven search and
 *    body mappings. These must pass before AND after an engine upgrade; a
 *    failure here means mapping behavior drifted and needs review.
 *
 * 2. Hardened behavior — specifies the createRequest(config) surface:
 *    redirect refusal, header filtering, timeout/abort, response size cap,
 *    the checkUrl policy hook, and pathname encoding. These fail until that
 *    surface is implemented.
 */
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@^1'
import request, * as requestModule from '../src/request.js'

const { createRequest } = requestModule

/**
 * A minimal evaluation context of the shape the engine hands a plugin.
 */
function context(input = {}, extra = {}) {
  return {
    input,
    source: input,
    target: {},
    output: {},
    errors: [],
    mappings: {},
    plugins: {},
    ...extra
  }
}

/**
 * Run a plugin invocation against a stubbed fetch, capturing the calls it
 * makes. The stub answers with a small JSON body.
 */
async function captureRequest(plugin, descriptor, options, ctx) {
  const original = globalThis.fetch
  const calls = []

  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init: init || {} })
    return Promise.resolve(
      new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    )
  }

  try {
    const result = await plugin(descriptor, options, ctx)
    return { calls, result }
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Start a throwaway local server for behavioral tests.
 */
function serve(handler) {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, handler)
  const origin = `http://127.0.0.1:${server.addr.port}`
  return { server, origin }
}

/**
 * Guard for tests that specify the configurable surface.
 */
function assertSurface() {
  assert(typeof createRequest === 'function', 'createRequest(config) is not implemented yet')
}

/**
 * 1. Golden request construction
 */

Deno.test('golden: origin, templated pathname, and static search', async () => {
  const { calls, result } = await captureRequest(
    request,
    {
      origin: 'https://api.example.test',
      pathname: '/things/{{id}}',
      search: { q: 'term' }
    },
    { id: '42', term: 'widgets' },
    context()
  )

  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, 'https://api.example.test/things/42?q=widgets')
  assertEquals(calls[0].init.method, 'GET')
  assertEquals(result._id, '42')
  assertEquals(result['content-type'], 'application/json')
  assertEquals(result.json, { ok: true })
})

Deno.test('golden: search params built by a mapping', async () => {
  const { calls } = await captureRequest(
    request,
    {
      origin: 'https://api.example.test',
      pathname: '/search',
      search: {
        mapping: {
          '/q': '/query',
          '/limit': { constant: '10' }
        }
      }
    },
    {},
    context({ query: 'deno' })
  )

  assertEquals(calls[0].url, 'https://api.example.test/search?q=deno&limit=10')
})

Deno.test('golden: request body built by a mapping', async () => {
  const { calls } = await captureRequest(
    request,
    {
      origin: 'https://api.example.test',
      pathname: '/items',
      method: 'POST',
      body: {
        mapping: {
          '/name': '/user/name',
          '/kind': { constant: 'gadget' }
        }
      }
    },
    {},
    context({ user: { name: 'Ada' } })
  )

  assertEquals(calls[0].init.method, 'POST')
  assertEquals(calls[0].init.body, '{"name":"Ada","kind":"gadget"}')
})

Deno.test('golden: url read from output by pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: '/link' },
    {},
    context({}, { output: { link: 'https://api.example.test/next' } })
  )

  assertEquals(calls[0].url, 'https://api.example.test/next')
})

Deno.test('golden: url read from source by pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: { source: '/URL' } },
    { URL: 'https://articles.example.test/vol-137/article.html?seq=2' },
    context()
  )

  assertEquals(calls[0].url, 'https://articles.example.test/vol-137/article.html?seq=2')
})

Deno.test('golden: url read from whole source by empty pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: { source: '' } },
    'https://articles.example.test/article.html',
    context()
  )

  assertEquals(calls[0].url, 'https://articles.example.test/article.html')
})

Deno.test('golden: url read from output by scoped pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: { output: '/link' } },
    {},
    context({}, { output: { link: 'https://api.example.test/next' } })
  )

  assertEquals(calls[0].url, 'https://api.example.test/next')
})

Deno.test('golden: url read from target by pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: { target: '/URL' } },
    {},
    context({}, { target: { URL: 'https://api.example.test/from-target' } })
  )

  assertEquals(calls[0].url, 'https://api.example.test/from-target')
})

Deno.test('golden: url read from input by pointer', async () => {
  const { calls } = await captureRequest(
    request,
    { url: { input: '/URL' } },
    {},
    context({ URL: 'https://api.example.test/from-input' })
  )

  assertEquals(calls[0].url, 'https://api.example.test/from-input')
})

Deno.test('a url object naming two scopes is refused', async () => {
  await assertRejects(
    () => captureRequest(request, { url: { source: '/a', output: '/b' } }, { a: 'x' }, context()),
    Error,
    'exactly one'
  )
})

Deno.test('a url object naming neither scope is refused', async () => {
  await assertRejects(
    () => captureRequest(request, { url: { pointer: '/a' } }, { a: 'x' }, context()),
    Error,
    'Invalid url'
  )
})

/**
 * 2. Hardened behavior
 */

Deno.test('descriptor headers are forwarded by the default plugin', async () => {
  const seen = {}
  const { server, origin } = serve((req) => {
    seen['x-api-key'] = req.headers.get('x-api-key')
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    await request({ origin, pathname: '/', headers: { 'x-api-key': 'k123' } }, {}, context())
    assertEquals(seen['x-api-key'], 'k123')
  } finally {
    await server.shutdown()
  }
})

Deno.test('redirects are refused, not followed', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    const { pathname } = new URL(req.url)
    hits.push(pathname)

    if (pathname === '/public') {
      return new Response(null, { status: 302, headers: { location: `${origin}/secret` } })
    }

    return new Response('{"secret":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest()
    await assertRejects(() => plugin({ origin, pathname: '/public' }, {}, context()))
    assertEquals(hits, ['/public'])
  } finally {
    await server.shutdown()
  }
})

Deno.test('allowHeaders: [] drops all descriptor headers', async () => {
  assertSurface()

  const seen = {}
  const { server, origin } = serve((req) => {
    seen.authorization = req.headers.get('authorization')
    seen.cookie = req.headers.get('cookie')
    seen['x-api-key'] = req.headers.get('x-api-key')
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ allowHeaders: [] })
    await plugin(
      {
        origin,
        pathname: '/',
        headers: { authorization: 'Bearer forged', cookie: 'a=b', 'x-api-key': 'k' }
      },
      {},
      context()
    )
    assertEquals(seen.authorization, null)
    assertEquals(seen.cookie, null)
    assertEquals(seen['x-api-key'], null)
  } finally {
    await server.shutdown()
  }
})

Deno.test('allowHeaders forwards only the named headers', async () => {
  assertSurface()

  const seen = {}
  const { server, origin } = serve((req) => {
    seen.authorization = req.headers.get('authorization')
    seen['x-api-key'] = req.headers.get('x-api-key')
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ allowHeaders: ['x-api-key'] })
    await plugin(
      {
        origin,
        pathname: '/',
        headers: { authorization: 'Bearer forged', 'x-api-key': 'k' }
      },
      {},
      context()
    )
    assertEquals(seen.authorization, null)
    assertEquals(seen['x-api-key'], 'k')
  } finally {
    await server.shutdown()
  }
})

Deno.test('a hung upstream aborts within the timeout', async () => {
  assertSurface()

  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { server, origin } = serve(async () => {
    await gate
    return new Response('{"late":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ timeoutMs: 250 })
    const started = Date.now()
    await assertRejects(() => plugin({ origin, pathname: '/' }, {}, context()))
    assert(Date.now() - started < 2000, 'request did not abort promptly')
  } finally {
    release()
    await server.shutdown()
  }
})

Deno.test('the timeout also covers a stalled response body', async () => {
  assertSurface()

  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { server, origin } = serve(() => {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          controller.enqueue(encoder.encode('{"partial":'))
          await gate
          controller.enqueue(encoder.encode('true}'))
          controller.close()
        } catch {
          // client aborted mid-body
        }
      }
    })
    return new Response(stream, { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ timeoutMs: 250 })
    const started = Date.now()
    await assertRejects(() => plugin({ origin, pathname: '/' }, {}, context()))
    assert(Date.now() - started < 2000, 'body read did not abort promptly')
  } finally {
    release()
    await server.shutdown()
  }
})

Deno.test('checkUrl rejects before any request is made', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    hits.push(new URL(req.url).pathname)
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({
      checkUrl: () => {
        throw new Error('destination not allowed')
      }
    })
    await assertRejects(
      () => plugin({ origin, pathname: '/internal' }, {}, context()),
      Error,
      'destination not allowed'
    )
    assertEquals(hits, [])
  } finally {
    await server.shutdown()
  }
})

Deno.test('checkUrl vets source-resolved urls before any request is made', async () => {
  assertSurface()

  const plugin = createRequest({
    checkUrl: (url) => {
      if (!url.startsWith('https://allowed.example.test/')) {
        throw new Error(`destination not allowed: ${url}`)
      }
    }
  })

  await assertRejects(
    () => plugin({ url: { source: '/URL' } }, { URL: 'http://192.0.2.1/internal' }, context()),
    Error,
    'destination not allowed'
  )
})

Deno.test('maxResponseBytes rejects an oversized body', async () => {
  assertSurface()

  const { server, origin } = serve(() => {
    const big = `{"data":"${'x'.repeat(10_000)}"}`
    return new Response(big, { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ maxResponseBytes: 1024 })
    await assertRejects(() => plugin({ origin, pathname: '/' }, {}, context()))
  } finally {
    await server.shutdown()
  }
})

Deno.test('pathname template values are URL-encoded', async () => {
  const { calls } = await captureRequest(
    request,
    { origin: 'https://api.example.test', pathname: '/things/{{id}}' },
    { id: 'a/../b c' },
    context()
  )

  assertEquals(calls[0].url, 'https://api.example.test/things/a%2F..%2Fb%20c')
})

/**
 * 3. Redirect policy
 *
 * Specifies the opt-in bounded follow surface: redirect: 'follow' with
 * maxRedirects and redirectSameOrigin, refusal remaining the default, and
 * every hop re-passing checkUrl. These fail until that surface is
 * implemented.
 */

Deno.test('follow: a same-origin 301 to the trailing-slash form is followed', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    const { pathname } = new URL(req.url)
    hits.push(pathname)

    if (pathname === '/article') {
      return new Response(null, { status: 301, headers: { location: `${origin}/article/` } })
    }

    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    const result = await plugin({ origin, pathname: '/article' }, {}, context())
    assertEquals(hits, ['/article', '/article/'])
    assertEquals(result.json, { ok: true })
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: every hop re-passes checkUrl before it is fetched', async () => {
  assertSurface()

  const hits = []
  const checked = []
  const { server, origin } = serve((req) => {
    hits.push(new URL(req.url).pathname)
    return new Response(null, { status: 301, headers: { location: `${origin}/secret` } })
  })

  try {
    const plugin = createRequest({
      redirect: 'follow',
      checkUrl: (url) => {
        checked.push(url)
        if (url.endsWith('/secret')) {
          throw new Error('destination not allowed')
        }
      }
    })
    await assertRejects(
      () => plugin({ origin, pathname: '/public' }, {}, context()),
      Error,
      'destination not allowed'
    )
    assertEquals(hits, ['/public'])
    assertEquals(checked, [`${origin}/public`, `${origin}/secret`])
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: refuses beyond maxRedirects', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    const { pathname } = new URL(req.url)
    hits.push(pathname)
    const next = Number(pathname.slice(1)) + 1
    return new Response(null, { status: 301, headers: { location: `${origin}/${next}` } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow', maxRedirects: 2 })
    const error = await assertRejects(
      () => plugin({ origin, pathname: '/1' }, {}, context()),
      Error,
      'Redirect refused'
    )
    assertEquals(hits, ['/1', '/2', '/3'])
    assertEquals(error.location, `${origin}/4`)
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: refuses a cross-origin target', async () => {
  assertSurface()

  const outside = []
  const { server: other, origin: otherOrigin } = serve((req) => {
    outside.push(new URL(req.url).pathname)
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })
  const { server, origin } = serve(() => {
    return new Response(null, { status: 301, headers: { location: `${otherOrigin}/elsewhere` } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await assertRejects(
      () => plugin({ origin, pathname: '/a' }, {}, context()),
      Error,
      'Redirect refused'
    )
    assertEquals(outside, [])
  } finally {
    await server.shutdown()
    await other.shutdown()
  }
})

Deno.test('follow: refuses a redirected non-GET request', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    hits.push(`${req.method} ${new URL(req.url).pathname}`)
    return new Response(null, { status: 301, headers: { location: `${origin}/items/` } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await assertRejects(
      () => plugin({ origin, pathname: '/items', method: 'POST' }, {}, context()),
      Error,
      'Redirect refused'
    )
    assertEquals(hits, ['POST /items'])
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: resolves a relative Location against the current url', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    const { pathname } = new URL(req.url)
    hits.push(pathname)

    if (pathname === '/article') {
      return new Response(null, { status: 301, headers: { location: '/article/' } })
    }

    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await plugin({ origin, pathname: '/article' }, {}, context())
    assertEquals(hits, ['/article', '/article/'])
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: refuses a redirect without a Location', async () => {
  assertSurface()

  const { server, origin } = serve(() => new Response(null, { status: 301 }))

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await assertRejects(
      () => plugin({ origin, pathname: '/a' }, {}, context()),
      Error,
      'Redirect refused'
    )
  } finally {
    await server.shutdown()
  }
})

Deno.test('follow: the timeout spans the whole redirect chain', async () => {
  assertSurface()

  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { server, origin } = serve(async (req) => {
    const { pathname } = new URL(req.url)

    if (pathname === '/a') {
      return new Response(null, { status: 301, headers: { location: `${origin}/b` } })
    }

    await gate
    return new Response('{"late":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow', timeoutMs: 250 })
    const started = Date.now()
    await assertRejects(() => plugin({ origin, pathname: '/a' }, {}, context()))
    assert(Date.now() - started < 2000, 'chain did not abort promptly')
  } finally {
    release()
    await server.shutdown()
  }
})

Deno.test('maxRedirects alone does not enable following', async () => {
  assertSurface()

  const hits = []
  const { server, origin } = serve((req) => {
    hits.push(new URL(req.url).pathname)
    return new Response(null, { status: 301, headers: { location: `${origin}/a/` } })
  })

  try {
    const plugin = createRequest({ maxRedirects: 5 })
    await assertRejects(
      () => plugin({ origin, pathname: '/a' }, {}, context()),
      Error,
      'Redirect refused'
    )
    assertEquals(hits, ['/a'])
  } finally {
    await server.shutdown()
  }
})

Deno.test('a refused redirect carries a typed error', async () => {
  assertSurface()

  const { server, origin } = serve(() => {
    return new Response(null, { status: 301, headers: { location: `${origin}/a/` } })
  })

  try {
    const plugin = createRequest()
    const error = await assertRejects(
      () => plugin({ origin, pathname: '/a' }, {}, context()),
      Error,
      'Redirect refused'
    )
    assertEquals(error.code, 'E_REDIRECT_REFUSED')
    assertEquals(error.status, 301)
    assertEquals(error.location, `${origin}/a/`)
  } finally {
    await server.shutdown()
  }
})

Deno.test('an unsupported redirect mode is refused at construction', () => {
  assertSurface()

  assertThrows(() => createRequest({ redirect: 'always' }), Error, 'Unsupported redirect mode')
})

/**
 * The https-upgrade cases stub fetch rather than use serve(): the local test
 * server cannot answer over TLS.
 */

function captureRedirect(handler) {
  const original = globalThis.fetch
  const calls = []

  globalThis.fetch = (url) => {
    calls.push(String(url))
    return Promise.resolve(handler(String(url)))
  }

  return { calls, restore: () => (globalThis.fetch = original) }
}

Deno.test('follow: an http→https upgrade of the same host is followed by default', async () => {
  assertSurface()

  const { calls, restore } = captureRedirect((url) => {
    if (url.startsWith('http://')) {
      return new Response(null, { status: 301, headers: { location: 'https://articles.example.test/a/' } })
    }
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await plugin({ url: { source: '' } }, 'http://articles.example.test/a', context())
    assertEquals(calls, [
      'http://articles.example.test/a',
      'https://articles.example.test/a/'
    ])
  } finally {
    restore()
  }
})

Deno.test('follow: redirectHttpsUpgrade false requires strict same-origin', async () => {
  assertSurface()

  const { calls, restore } = captureRedirect(() => {
    return new Response(null, { status: 301, headers: { location: 'https://articles.example.test/a/' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow', redirectHttpsUpgrade: false })
    await assertRejects(
      () => plugin({ url: { source: '' } }, 'http://articles.example.test/a', context()),
      Error,
      'Redirect refused'
    )
    assertEquals(calls, ['http://articles.example.test/a'])
  } finally {
    restore()
  }
})

Deno.test('follow: an upgrade off the default ports is refused', async () => {
  assertSurface()

  const { calls, restore } = captureRedirect(() => {
    return new Response(null, { status: 301, headers: { location: 'https://articles.example.test:8080/a/' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await assertRejects(
      () => plugin({ url: { source: '' } }, 'http://articles.example.test:8080/a', context()),
      Error,
      'Redirect refused'
    )
    assertEquals(calls, ['http://articles.example.test:8080/a'])
  } finally {
    restore()
  }
})

Deno.test('follow: never follows an https→http downgrade', async () => {
  assertSurface()

  const { calls, restore } = captureRedirect(() => {
    return new Response(null, { status: 301, headers: { location: 'http://articles.example.test/a/' } })
  })

  try {
    const plugin = createRequest({ redirect: 'follow' })
    await assertRejects(
      () => plugin({ url: { source: '' } }, 'https://articles.example.test/a', context()),
      Error,
      'Redirect refused'
    )
    assertEquals(calls, ['https://articles.example.test/a'])
  } finally {
    restore()
  }
})
