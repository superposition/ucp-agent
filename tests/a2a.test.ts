import { describe, expect, test } from "bun:test";
import {
  A2AClient,
  A2AServer,
  A2AAgentCardSchema,
  A2AMessageSchema,
  createUCPCapabilities,
  createUCPA2AServer,
} from "../src/a2a";

describe("A2A Protocol Schemas", () => {
  test("validates agent card", () => {
    const card = {
      id: "test-agent",
      name: "Test Agent",
      version: "1.0.0",
      endpoint: "http://localhost:3000",
      capabilities: [
        { id: "test.cap", name: "test", version: "1.0.0" },
      ],
    };
    expect(() => A2AAgentCardSchema.parse(card)).not.toThrow();
  });

  test("validates message", () => {
    const msg = {
      id: "msg-1",
      type: "request",
      from: "agent-a",
      to: "agent-b",
      capability: "test.cap",
      payload: { data: "test" },
      timestamp: new Date().toISOString(),
    };
    expect(() => A2AMessageSchema.parse(msg)).not.toThrow();
  });
});

describe("A2AClient", () => {
  test("creates client with config", () => {
    const client = new A2AClient({
      agentId: "test-client",
      agentName: "Test Client",
    });
    expect(client).toBeDefined();
    expect(client.getDiscoveredAgents()).toEqual([]);
  });
});

describe("A2AServer", () => {
  test("creates server with config", () => {
    const server = new A2AServer({
      agentId: "test-server",
      agentName: "Test Server",
      endpoint: "http://localhost:3000",
    });
    expect(server).toBeDefined();
  });

  test("registers capability", () => {
    const server = new A2AServer({
      agentId: "test-server",
      agentName: "Test Server",
      endpoint: "http://localhost:3000",
    });

    server.registerCapability(
      { name: "greet", description: "Say hello", version: "1.0.0" },
      async (msg) => ({ greeting: `Hello ${msg.payload}` })
    );

    const card = server.getAgentCard();
    expect(card.capabilities.length).toBe(1);
    expect(card.capabilities[0].name).toBe("greet");
  });

  test("handles invoke", async () => {
    const server = new A2AServer({
      agentId: "test-server",
      agentName: "Test Server",
      endpoint: "http://localhost:3000",
    });

    server.registerCapability(
      { name: "echo", description: "Echo back", version: "1.0.0" },
      async (msg) => msg.payload
    );

    const response = await server.handleInvoke({
      id: "req-1",
      type: "request",
      from: "client",
      to: "test-server",
      capability: "test-server.echo",
      payload: { message: "hello" },
      timestamp: new Date().toISOString(),
    });

    expect(response.type).toBe("response");
    expect(response.payload).toEqual({ message: "hello" });
  });

  test("handles unknown capability", async () => {
    const server = new A2AServer({
      agentId: "test-server",
      agentName: "Test Server",
      endpoint: "http://localhost:3000",
    });

    const response = await server.handleInvoke({
      id: "req-1",
      type: "request",
      from: "client",
      to: "test-server",
      capability: "unknown.cap",
      payload: {},
      timestamp: new Date().toISOString(),
    });

    expect(response.type).toBe("error");
  });
});

describe("UCP A2A Extension", () => {
  test("creates UCP capabilities", () => {
    const caps = createUCPCapabilities("http://localhost:3000");
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((c) => c.id === "ucp.discover")).toBe(true);
    expect(caps.some((c) => c.id === "ucp.checkout.create")).toBe(true);
  });

  test("creates UCP A2A server", () => {
    const server = createUCPA2AServer(
      {
        agentId: "ucp-agent",
        agentName: "UCP Agent",
        endpoint: "http://localhost:4000",
      },
      "http://localhost:3000"
    );

    const card = server.getAgentCard();
    expect(card.id).toBe("ucp-agent");
    expect(card.capabilities.length).toBeGreaterThan(0);
  });
});
