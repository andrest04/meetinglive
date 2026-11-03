// Fake llama-server for tests: /health, /tokenize and /v1/chat/completions over HTTP with the
// same auth rule as the real one. Behaviour flags come in as extra args:
//   --fake-load-ms N   answer /health with 503 for N ms
//   --fake-exit-early  print a line and exit 3 before listening
import http from 'node:http';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const port = Number(arg('--port'));
const key = arg('--api-key');
const loadMs = Number(arg('--fake-load-ms') ?? 0);

if (argv.includes('--fake-exit-early')) {
  console.error('error: failed to load model, simulated');
  process.exit(3);
}

const readyAt = Date.now() + loadMs;
const stats = { chatStarted: 0, chatAborted: 0 };

const server = http.createServer((req, res) => {
  const url = req.url ?? '';
  if (url === '/health') {
    res.statusCode = Date.now() >= readyAt ? 200 : 503;
    res.end(JSON.stringify({ status: res.statusCode === 200 ? 'ok' : 'loading model' }));
    return;
  }
  if (url === '/__info') {
    res.end(JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid, stats }));
    return;
  }
  if (req.headers.authorization !== `Bearer ${key}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = body ? JSON.parse(body) : {};
    if (url === '/tokenize') {
      res.end(JSON.stringify({ tokens: String(json.content ?? '').split(/\s+/).filter(Boolean).map((_, i) => i) }));
      return;
    }
    if (url === '/v1/chat/completions') {
      stats.chatStarted += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const total = Math.min(json.max_tokens ?? 5, 1000);
      let sent = 0;
      let closed = false;
      res.on('close', () => {
        if (!closed && sent < total) stats.chatAborted += 1;
        closed = true;
      });
      const tick = setInterval(() => {
        if (closed) return clearInterval(tick);
        if (sent < total) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${sent} ` }, finish_reason: null }] })}\n\n`);
          sent += 1;
          return;
        }
        clearInterval(tick);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: total } })}\n\n`);
        res.write('data: [DONE]\n\n');
        closed = true;
        res.end();
      }, 15);
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
server.listen(port, '127.0.0.1');
