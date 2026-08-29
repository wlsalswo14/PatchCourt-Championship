import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const port = Number(process.env.PATCHCOURT_NESTED_PORT ?? 4196);
const prefix = "/PatchCourt-Championship/";
const distRoot = resolve(import.meta.dirname, "../dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end("not found");
      return;
    }
    const relative = url.pathname.slice(prefix.length) || "index.html";
    let file = resolve(distRoot, relative);
    if (file !== distRoot && !file.startsWith(`${distRoot}${sep}`)) {
      response.writeHead(400).end("invalid path");
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      file = resolve(distRoot, "index.html");
    }
    const bytes = await readFile(file);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(500).end("nested static server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`nested-static-ready http://127.0.0.1:${port}${prefix}`);
});
