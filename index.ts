import { createUCPServer } from "./src/server/ucp-server";
import { UCPClaudeAgent } from "./src/agent/claude-agent";

const PORT = parseInt(process.env.PORT || "3000");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  // Start the UCP merchant server
  const server = createUCPServer({
    merchantId: "demo-merchant",
    merchantName: "UCP Demo Store",
    port: PORT,
  });

  console.log(`Starting UCP server on port ${PORT}...`);

  Bun.serve({
    port: PORT,
    fetch: server.fetch,
  });

  console.log(`UCP Discovery: http://localhost:${PORT}/.well-known/ucp`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  // If API key is provided, also start the Claude agent in interactive mode
  if (ANTHROPIC_API_KEY) {
    console.log("\nClaude agent is available. Starting interactive mode...\n");

    const agent = new UCPClaudeAgent({
      anthropicApiKey: ANTHROPIC_API_KEY,
      merchantEndpoint: `http://localhost:${PORT}`,
    });

    // Simple REPL for testing
    const prompt = "You: ";
    process.stdout.write(prompt);

    for await (const line of console) {
      if (line.trim().toLowerCase() === "exit") {
        console.log("Goodbye!");
        process.exit(0);
      }

      try {
        const response = await agent.chat(line);
        console.log(`\nAssistant: ${response}\n`);
      } catch (error) {
        console.error(`Error: ${error}`);
      }

      process.stdout.write(prompt);
    }
  } else {
    console.log("\nSet ANTHROPIC_API_KEY to enable Claude agent mode.");
    console.log("Server running in API-only mode...");
  }
}

main().catch(console.error);
