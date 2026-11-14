/** A tool failure the model can recover from; its message goes back as an is_error tool_result. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
