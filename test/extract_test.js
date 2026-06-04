/**
 * Tests for the scraper `replace` keyword in extractHTML.
 *
 *   deno test --allow-read
 */
import { assertEquals } from 'jsr:@std/assert@^1'
import * as cheerio from 'npm:cheerio@1.0.0'
import { extractHTML } from '../src/extract.js'

function run(html, scraper) {
  const $ = cheerio.load(html)
  return extractHTML($, scraper, $.root())
}

Deno.test('replace strips a trailing site suffix from a string', () => {
  const out = run('<h1>Ghostwriting Federalism | Yale Law Journal</h1>', {
    title: { selector: 'h1', text: true, replace: [['\\s*\\|.*$', '']] }
  })
  assertEquals(out.title, 'Ghostwriting Federalism')
})

Deno.test('replace applies multiple [pattern, replacement] pairs in order', () => {
  const out = run('<p class="by">By Kurt T. Lash*</p>', {
    author: { selector: '.by', text: true, replace: [['^By\\s+', ''], ['\\*+$', '']] }
  })
  assertEquals(out.author, 'Kurt T. Lash')
})

Deno.test('replace maps over an array produced by split', () => {
  const out = run('<p class="x">a|b|c</p>', {
    parts: { selector: '.x', text: true, split: '|', replace: [['a', 'Z']] }
  })
  assertEquals(out.parts, ['Z', 'b', 'c'])
})

Deno.test('replace is a no-op when not specified (regression)', () => {
  const out = run('<h1>Plain Title</h1>', { title: { selector: 'h1', text: true } })
  assertEquals(out.title, 'Plain Title')
})
