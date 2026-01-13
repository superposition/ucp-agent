import { runMCPServer } from "./ucp-mcp-server";

const MERCHANT_ENDPOINT = process.env.MERCHANT_ENDPOINT || "http://localhost:3000";

console.error("Starting UCP MCP Server...");
console.error(`Connecting to merchant at: ${MERCHANT_ENDPOINT}`);

runMCPServer({
  merchantEndpoint: MERCHANT_ENDPOINT,
}).catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
