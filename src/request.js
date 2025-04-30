/**
 * Dependencies
 */
import { map } from '@christiansmith/mapper-js/src/Mapper.js'
import JSONPointer from './JSONPointer.js'
//import fetch from 'cross-fetch'
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
    // we should be sanitizing these values
    return options[param] || ''
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
    ? Object.entries(await map(search, context)) //
    : Object.entries(search || {})

  for (let [key, value] of entries) {
    params.set(key, options[value] || value)
  }

  return params.toString()
}

/**
 * getUrl
 */
async function getUrl(options, descriptor, context) {
  const { output } = context
  let url

  if (descriptor.url) {
    url = JSONPointer.get(output, descriptor.url)
  } else {
    const origin = descriptor.origin
    const pathname = getPathname(options, descriptor)
    const search = await getSearchParams(options, descriptor, context)

    url = `${origin}${pathname}${search ? `?${search}` : ''}`
  }

  return url
}

/**
 * Request
 */
async function request(descriptor, options, context) {
  const { decache, encache, throttle } = context?.plugins
  const cached = decache && (await decache(options, context))

  if (!cached || options.force) {
    throttle && (await throttle(options, context))

    // form the request options
    const url = await getUrl(options, descriptor, context)
    const method = descriptor.method || 'GET'

    // HERE IS WHY THIS IS A FUNCTION IN PREVIOUS ITERATION
    // WE NEED TO BE ABLE TO SET COOKIES
    const headers = descriptor.headers
    const body = descriptor.body && JSON.stringify(await map(descriptor.body, context))

    // fetch the response
    const response = await fetch(url, { method, headers, body })

    // parse the response
    const result = await parse(response, options, descriptor)

    // cache the parsed response
    encache && (await encache(result))
    return result
  } else {
    return cached
  }
}

/**
 * Export
 */
export default request
