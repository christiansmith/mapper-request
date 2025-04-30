//import { replace as rep } from 'https://deno.land/x/fun@v2.0.0/string.ts'
export function extractHTML($, scraper, node) {
  const result = {}

  for (let [key, desc] of Object.entries(scraper)) {
    const { selector, index } = desc
    const { text, attr, data, each } = desc
    const { split, replace, trim, int } = desc
    const { get, list, filter, map } = desc
    const { attribute, lastChild } = desc

    // mutable variables
    let select = selector
    let value

    // get selector from shorthand usage
    //if (typeof text === 'string') select = text
    //if (typeof attr === 'string') select = attr

    // use selector if defined
    let el = select ? $(node).find(select) : $(node)

    // index (take the nth item)
    if (index) el = $(el[index])
    if (lastChild) el = $(el).lastChild()
    if (text) value = el.text()
    if (attr) value = el.attr(attr)
    if (data) value = $(el).data(data)

    // merge w/above
    if (attribute) {
      const values = []

      node.map((_, el) => {
        values.push(el.attribs[attribute])
      })

      if (values.length > 0) {
        value = values
      }
    }

    // match
    if (typeof value === 'string' && desc.match) {
      const result = value.match(new RegExp(desc.match))
      if (result) value = result.shift()
    }

    // split
    if (typeof value === 'string' && split) {
      value = value.split(split)
    }

    // replace
    //if (value && replace) {
    //  if (Array.isArray(value)) {
    //    value = value.map((item) => {
    //      let tmp = item
    //      replace.forEach(([pattern, replacement]) => {
    //        tmp = rep(new RegExp(pattern, 'g'), replacement)(tmp)
    //      })
    //    })
    //  } else {
    //    replace.forEach(([pattern, replacement]) => {
    //      return (value = rep(new RegExp(pattern, 'g'), replacement)(value))
    //    })
    //  }
    //}

    // trim array
    if (value && trim && Array.isArray(value)) {
      value = value.map((item) => {
        return typeof item === 'string' ? item.trim() : item
      })
    }

    // trim string
    if (typeof value === 'string' && trim) {
      value = value.trim()
    }

    // get / getter
    if (get) {
      value = get(value)
    }
    //if (getter) {
    //  body[key] = getter(node, { $ }) // refactor the extractors to expect $, w/o page obj?
    //}

    // parse each element for array of ints
    if (value && int && Array.isArray(value)) {
      value = value.map((item) => parseInt(item))
    }

    // parseInt
    if (typeof value === 'string' && int) {
      value = parseInt(value) || undefined
    }

    // list
    if (list && value && !Array.isArray(value)) {
      value = [value]
    }

    // apply nested scraper over each element
    if (each) {
      let values = []

      $(el).map((_, child) => {
        // this probably needs another param for context
        values.push(extractHTML($, each, child))
      })

      // filter the items with provided function
      if (typeof filter === 'function') {
        values = values.filter(filter)
      }

      // map over the items with provided function
      if (typeof map === 'function') {
        values = values.map(map)
      }

      result[key] = values
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * extractMetaTags
 */
export function extractMetaTags($) {
  const meta = {}

  if ($) {
    $('meta').map((_, el) => {
      const { name, property, itemprop, content } = el.attribs

      if (name) {
        const values = meta[name.toLowerCase()] || []
        values.push(content)
        meta[name.toLowerCase()] = values
      }

      if (property) {
        const values = meta[property.toLowerCase()] || []
        values.push(content)
        meta[property.toLowerCase()] = values
      }

      if (itemprop) {
        const values = meta[itemprop.toLowerCase()] || []
        values.push(content)
        meta[itemprop.toLowerCase()] = values
      }
    })
  }

  return meta
}

/**
 * extractLinkedData
 */
export function extractLinkedData($) {
  const node = $('script[type="application/ld+json"]')
  const json = node.html()
  let ld = {}

  try {
    ld = JSON.parse(json)
  } catch (err) {
    // console.log(err)
  }

  return ld
}

export default { extractHTML, extractLinkedData, extractMetaTags }
