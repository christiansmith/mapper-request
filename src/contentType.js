/**
 * contentType
 */
export default function contentType(response) {
  return response.headers.get('content-type').split(';').shift().trim()
}
