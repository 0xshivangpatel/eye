import { createServer } from "./app.js";

const port = Number(process.env.PORT ?? 11470);
// Listen on all interfaces so phones/TVs on the LAN and party guests can connect.
const host = process.env.HOST ?? "0.0.0.0";

const instance = createServer();
instance.server.listen(port, host, () => {
  console.log(`Marquee server listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
  console.log(`Web app: http://127.0.0.1:${port}/app/ (after \`npm run build\`)`);
});

const shutdown = () => {
  void instance.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
