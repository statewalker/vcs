/**
 * Converts an async stream of Uint8Array chunks into lines.
 * Handles both LF and CRLF line endings.
 *
 * @param input The input async iterable stream
 */
export async function* toLines(
  input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in buffer
    buffer = lines.pop() || "";
    for (const line of lines) {
      yield trimEnd(line, "\r");
    }
  }
  if (buffer.length > 0) {
    yield trimEnd(buffer, "\r");
  }
  function trimEnd(str: string, char: string[1]): string {
    return str.endsWith(char) ? str.slice(0, -char.length) : str;
  }
}
