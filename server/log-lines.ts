import { createReadStream } from 'node:fs';

const MAX_LINE_BYTES = 16 * 1024 * 1024;

type LogLine = {
  text: string | null;
  offset: number;
};

/**
 * Stream complete UTF-8 records within a fixed file snapshot, bounding line memory.
 * @param path Session log to read.
 * @param start Byte offset of the first unprocessed line.
 * @param size File size captured before reading; later appends wait for the next scan.
 * @returns Complete lines and their checkpoint offsets; null text marks an oversized line.
 */
export async function* readLogLines(path: string, start: number, size: number): AsyncGenerator<LogLine> {
  if (start >= size) {
    return;
  }

  const stream = createReadStream(path, {
    start,
    end: size - 1,
    highWaterMark: 64 * 1024,
  });
  let offset = start;
  let pending = Buffer.alloc(0);
  let oversized = false;

  // Only newline-terminated records advance the caller's checkpoint.
  for await (const data of stream) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    let lineStart = 0;

    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 10) {
        continue;
      }

      const piece = chunk.subarray(lineStart, index);
      const bytes = pending.length + piece.length + 1;
      let text: string | null = null;

      if (!oversized && bytes <= MAX_LINE_BYTES) {
        const line = pending.length ? Buffer.concat([pending, piece]) : piece;
        text = line.toString('utf8');
      }

      offset += bytes;
      yield { text, offset };
      pending = Buffer.alloc(0);
      oversized = false;
      lineStart = index + 1;
    }

    pending = Buffer.concat([pending, chunk.subarray(lineStart)]);

    // Discard oversized content while retaining its byte count for the next checkpoint.
    if (pending.length > MAX_LINE_BYTES) {
      offset += pending.length;
      pending = Buffer.alloc(0);
      oversized = true;
    }
  }

  // Roll back this file until the oversized record has a terminating newline.
  if (oversized) {
    throw new Error('An oversized unfinished log line will be retried next scan.');
  }
}
