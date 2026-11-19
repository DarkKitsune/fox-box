import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.FOXBOX_TEST_PORT || 4319);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const relative = decodeURIComponent(url.pathname === "/" ? "/scripts/mock-host.html" : url.pathname);
    const file = path.resolve(root, `.${relative}`);
    const inside = path.relative(root, file);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const content = await fs.readFile(file);
    response.writeHead(200, {
      "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fox Box panel harness: http://127.0.0.1:${port}/`);
});
