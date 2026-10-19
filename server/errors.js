// Los errores esperados llevan un mensaje apto para la interfaz; no exponen tokens ni SQL.
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
