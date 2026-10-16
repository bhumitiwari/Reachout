import app from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

await prisma.$connect();
const server = app.listen(config.PORT, () => {
  console.log(`Outreach Mailer API listening on port ${config.PORT}`);
});
async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
