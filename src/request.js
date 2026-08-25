/**
 * Dependencies
 */
import { map } from '@christiansmith/mapper-js/src/Mapper.js'
import JSONPointer from './JSONPointer.js'
import parse from './parse.js'

/**
 * Pathname template variable
 */
const VARIABLE = /\{\{([^\}]+)\}\}/g

/**
 * getPathname
 */
function getPathname(options, descriptor) {
  return descriptor?.pathname?.replace(VARIABLE, (_, param) => {
    return encodeURIComponent(options[param] || '')
  })
}

/**
 * getSearchParams
 */
async function getSearchParams(options, descriptor, context) {
  const params = new URLSearchParams()

  const search = descriptor.search
  const mapping = search?.mapping

  const entries = mapping
    ? Object.entries(await map(search, { ...context, target: {} })) //
    : Object.entries(search || {})

  for (const [key, value] of entries) {
    params.set(key, options[value] || value)
  }

  return params.toString()
}

/**
 * getUrl
 *
 * `url` locates the whole request URL. A pointer string reads from the
 * output being built (chained requests); `{ source: <pointer> }` reads from
 * the source value instead, for URLs that arrive as data. Either way the
 * resolved value is used verbatim. Destination policy belongs to checkUrl.
 */
async function getUrl(options, descriptor, context) {
  const locator = descriptor.url
  let url

  if (locator) {
    if (typeof locator === 'string') {
      url = JSONPointer.get(context.output, locator)
    } else {
      const scopes = ['source', 'target', 'input', 'output']
      const named = scopes.filter((scope) => typeof locator[scope] === 'string')

      if (named.length !== 1) {
        throw new Error('Invalid url: exactly one of source, target, input, or output')
      }

      const [scope] = named
      const root = scope === 'source' ? options : context[scope]

      url = JSONPointer.get(root, locator[scope])
    }
  } else {
    const origin = descriptor.origin
    const pathname = getPathname(options, descriptor)
    const search = await getSearchParams(options, descriptor, context)

    url = `${origin}${pathname}${search ? `?${search}` : ''}`
  }

  return url
}

/**
 * filterHeaders
 *
 * Descriptor headers are authored by whoever authors the mapping, so which
 * of them reach the wire is deployment policy: allowHeaders true forwards
 * them all, a list forwards only the named headers (case-insensitive).
 */
function filterHeaders(headers, allowHeaders) {
  if (!headers || allowHeaders === true) {
    return headers
  }

  const allowed = new Set(allowHeaders.map((name) => name.toLowerCase()))

  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    return allowed.has(name.toLowerCase())
  }))
}

/**
 * refuseRedirect
 *
 * The upstream chooses the redirect target, so following would defeat any
 * destination policy. Refuse and name the target instead.
 */
function refuseRedirect(response, url) {
  const { status, headers, body } = response

  if ([301, 302, 303, 307, 308].includes(status)) {
    const location = headers.get('location')
    const detail = location ? ` to ${location}` : ''

    body?.cancel()

    throw new Error(
      `Redirect refused: ${url} responded ${status}${detail}`
    )
  }
}

/**
 * capResponse
 *
 * Read the body up to maxResponseBytes and rebuild the response for parsing.
 * A declared or actual size over the cap rejects; the stream read stays under
 * the request's abort signal.
 */
async function capResponse(response, maxResponseBytes) {
  const { status, headers, body } = response
  const declared = Number(headers.get('content-length') || 0)

  if (declared > maxResponseBytes) {
    body?.cancel()
    throw new Error(`Response exceeds ${maxResponseBytes} bytes`)
  }

  if (!body) {
    return response
  }

  const reader = body.getReader()
  const chunks = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    received += value.byteLength

    if (received > maxResponseBytes) {
      reader.cancel()
      throw new Error(`Response exceeds ${maxResponseBytes} bytes`)
    }

    chunks.push(value)
  }

  return new Response(new Blob(chunks), { status, headers })
}

/**
 * createRequest
 *
 * Build a request plugin with policy fixed at construction time. Policy
 * lives in configuration rather than on the descriptor: descriptors may be
 * authored by callers, configuration only by the deployment.
 */
export function createRequest(config = {}) {
  const {
    timeoutMs = 10000,
    redirect = 'refuse',
    allowHeaders = true,
    checkUrl,
    maxResponseBytes
  } = config

  if (redirect !== 'refuse') {
    throw new Error(`Unsupported redirect mode ${redirect}: only "refuse" is implemented`)
  }

  return async function request(descriptor, options, context) {
    const { decache, encache, throttle } = context?.plugins
    const cached = decache && (await decache(options, context))

    if (!cached || options.force) {
      throttle && (await throttle(options, context))

      // form the request options
      const url = await getUrl(options, descriptor, context)

      checkUrl && (await checkUrl(url))

      const method = descriptor.method || 'GET'
      const headers = filterHeaders(descriptor.headers, allowHeaders)
      const body = descriptor.body && JSON.stringify(await map(descriptor.body, context))

      // the abort signal spans the fetch AND the body reads in parse, so a
      // stalled body cannot outlive the timeout
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs} ms: ${url}`))
      }, timeoutMs)

      try {
        // fetch the response
        let response = await fetch(url, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal
        })

        refuseRedirect(response, url)

        if (maxResponseBytes) {
          response = await capResponse(response, maxResponseBytes)
        }

        // parse the response
        const result = await parse(response, options, descriptor)

        // cache the parsed response
        encache && (await encache(result))
        return result
      } finally {
        clearTimeout(timer)
      }
    } else {
      return cached
    }
  }
}

/**
 * Request
 */
const request = createRequest()

/**
 * Export
 */
export default request
