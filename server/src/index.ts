import { createServer } from "./app.js";

const port = Number(process.env.PORT ?? 11470);
// Listen on all interfaces so phones/TVs on the LAN and party guests can connect.
const host = process.env.HOST ?? "0.0.0.0";

const instance = createServer();

// If an admin account was just created without a provided password, print the
// generated one once so the operator can sign in and change it.
if (instance.accounts.generatedAdminPassword) {
  const user = process.env.MARQUEE_ADMIN_USER || "aeon";
  console.log("\n============================================================");
  console.log(" Marquee created an admin account on first run:");
  console.log(`   username: ${user}`);
  console.log(`   password: ${instance.accounts.generatedAdminPassword}`);
  console.log(" Set MARQUEE_ADMIN_PASSWORD to choose your own, or change it");
  console.log(" in Settings → Account after signing in.");
  console.log("============================================================\n");
}

instance.server.listen(port, host, () => {
  console.log(`Marquee server listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
  console.log(`Web app: http://127.0.0.1:${port}/app/ (after \`npm run build\`)`);
});

const shutdown = () => {
  void instance.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
