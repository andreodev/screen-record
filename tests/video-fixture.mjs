import { createReadStream, statSync } from 'node:fs';

// Browsers need byte ranges to seek fixtures just as they seek Tauri asset URLs.
export function videoFixture(path) {
  const size = statSync(path).size;
  return (request, response) => {
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Accept-Ranges', 'bytes');
    const range = request.headers.range;
    let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      start = match ? Number(match[1]) : size;
      end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` });
        response.end();
        return;
      }
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    response.setHeader('Content-Length', end - start + 1);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(path, { start, end });
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  };
}
