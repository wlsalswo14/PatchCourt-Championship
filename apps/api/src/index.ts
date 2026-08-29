import { createApiServer } from "./server.js";

const port = Number.parseInt(process.env.PATCHCOURT_API_PORT ?? "8787", 10);
const host = process.env.PATCHCOURT_API_HOST?.trim() || "127.0.0.1";
const server = createApiServer();

server.listen(port, host, () => {
  console.log(`PatchCourt API listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
