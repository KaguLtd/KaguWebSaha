/** Only deliberate, user-facing reporting errors may be exposed by the API. */
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}
