#!/usr/bin/env bun
import { parseArgs } from "util";
import { createUCPServer } from "../server";
import { UCPClaudeAgent } from "../agent";

const VERSION = "0.1.0";

const HELP = `
ucp-agent - Universal Commerce Protocol CLI

Usage: ucp <command> [options]

Commands:
  discover <url>     Discover merchant UCP capabilities
  checkout <url>     Start interactive checkout flow
  serve              Start local UCP server
  agent              Run interactive agent chat
  version            Show version

Options:
  -h, --help         Show this help message
  -v, --version      Show version

Examples:
  ucp discover https://merchant.example.com
  ucp serve --port 3000
  ucp agent --merchant https://localhost:3000
`;

async function discoverCommand(url: string) {
  const endpoint = url.endsWith("/.well-known/ucp") ? url : `${url}/.well-known/ucp`;

  console.log(`Discovering UCP capabilities at ${endpoint}...`);

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.error(`Error: HTTP ${response.status}`);
      process.exit(1);
    }

    const data = await response.json();
    console.log("\nMerchant Capabilities:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function serveCommand(options: { port?: number; merchantId?: string; merchantName?: string }) {
  const port = options.port || 3000;
  const merchantId = options.merchantId || "cli-merchant";
  const merchantName = options.merchantName || "CLI Test Merchant";

  const app = createUCPServer({ merchantId, merchantName, port });

  console.log(`Starting UCP server...`);
  console.log(`  Merchant: ${merchantName} (${merchantId})`);
  console.log(`  Port: ${port}`);
  console.log(`  Discovery: http://localhost:${port}/.well-known/ucp`);
  console.log(`  Checkout: http://localhost:${port}/ucp/checkout`);
  console.log("\nPress Ctrl+C to stop\n");

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

async function agentCommand(options: { merchant?: string; apiKey?: string }) {
  const merchantEndpoint = options.merchant || "http://localhost:3000";
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable required");
    console.error("Set it with: export ANTHROPIC_API_KEY=your-key");
    process.exit(1);
  }

  const agent = new UCPClaudeAgent({
    anthropicApiKey: apiKey,
    merchantEndpoint,
    debug: true,
  });

  console.log(`UCP Agent connected to ${merchantEndpoint}`);
  console.log("Type 'quit' to exit\n");

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      try {
        const response = await agent.chat(input);
        console.log(`\nAgent: ${response}\n`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }

      prompt();
    });
  };

  prompt();
}

async function checkoutCommand(url: string) {
  console.log(`Starting checkout flow with ${url}...`);

  // First discover the merchant
  await discoverCommand(url);

  console.log("\nTo complete checkout, use the agent command:");
  console.log(`  ucp agent --merchant ${url}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(HELP);
    process.exit(0);
  }

  if (args[0] === "-v" || args[0] === "--version" || args[0] === "version") {
    console.log(`ucp-agent v${VERSION}`);
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "discover": {
      if (!commandArgs[0]) {
        console.error("Error: URL required");
        console.error("Usage: ucp discover <url>");
        process.exit(1);
      }
      await discoverCommand(commandArgs[0]);
      break;
    }

    case "serve": {
      const { values } = parseArgs({
        args: commandArgs,
        options: {
          port: { type: "string", short: "p" },
          "merchant-id": { type: "string" },
          "merchant-name": { type: "string" },
        },
        allowPositionals: true,
      });
      await serveCommand({
        port: values.port ? parseInt(values.port) : undefined,
        merchantId: values["merchant-id"],
        merchantName: values["merchant-name"],
      });
      break;
    }

    case "agent": {
      const { values } = parseArgs({
        args: commandArgs,
        options: {
          merchant: { type: "string", short: "m" },
          "api-key": { type: "string", short: "k" },
        },
        allowPositionals: true,
      });
      await agentCommand({
        merchant: values.merchant,
        apiKey: values["api-key"],
      });
      break;
    }

    case "checkout": {
      if (!commandArgs[0]) {
        console.error("Error: URL required");
        console.error("Usage: ucp checkout <url>");
        process.exit(1);
      }
      await checkoutCommand(commandArgs[0]);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
