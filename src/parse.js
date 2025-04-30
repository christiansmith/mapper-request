/**
 * Dependencies
 */
import JSONPointer from './JSONPointer.js'
import { XMLParser } from 'fast-xml-parser'
import cheerio from 'cheerio'
import contentType from './contentType.js'
import { extractHTML, extractLinkedData, extractMetaTags } from './extract.js'

/**
 * parse
 */
async function parse(response, options, descriptor) {
  const type = await contentType(response)
  const parsed = { 'content-type': type }

  switch (type) {
    case 'application/json':
      parsed.json = await response.json()
      break

    // rss too?
    // let's go through a list of media types
    case 'text/xml':
    case 'application/atom+xml':
    case 'application/xml':
      const xml = await response.text()
      const parser = new XMLParser({
        ignoreAttributes: false
      })

      parsed.xml = xml
      parsed.json = parser.parse(xml)
      break

    case 'text/html':
      const scraper = descriptor.scraper
      const html = await response.text()
      const $ = cheerio.load(html)

      parsed.ld = extractLinkedData($)
      parsed.meta = extractMetaTags($)
      parsed.data = scraper && extractHTML($, scraper, $('html'))
      parsed.html = html
      break

    default:
      throw new Error(`Unknown content type ${type}`)
  }

  if (descriptor.pointer) {
    parsed.data = JSONPointer.get(parsed, descriptor.pointer)
  }

  // do stuff
  return {
    _id: options.id,
    ...parsed,
    cached: new Date().toISOString(),
    expires: new Date() // do some date math here
  }
}

/**
 * Export
 */
export default parse
