/**
 * RedirectRefusedError
 *
 * A redirect the deployment's policy declined to follow. Carries the
 * response status and the refused target so a consuming service can
 * classify the refusal as a policy outcome rather than an internal fault.
 */
export default class RedirectRefusedError extends Error {
  code = 'E_REDIRECT_REFUSED'

  constructor(url, status, location) {
    const detail = location ? ` to ${location}` : ''
    super(`Redirect refused: ${url} responded ${status}${detail}`)

    this.name = 'RedirectRefusedError'
    this.status = status
    if (location) this.location = location
  }
}
