import express, { Request, Response } from "express";
import crypto from "crypto";

// ==========================================
// Types & Interfaces
// ==========================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface McpSession {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  clientInfo?: {
    name: string;
    version: string;
  };
  initialized: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// ==========================================
// Session Store (In-Memory with Auto-Prune)
// ==========================================

class SessionStore {
  private sessions = new Map<string, McpSession>();
  private readonly ttlMs: number;

  constructor(ttlMinutes = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;
    setInterval(() => this.pruneStaleSessions(), 10 * 60 * 1000).unref();
  }

  getOrCreate(sessionId?: string): McpSession {
    const now = Date.now();
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastActiveAt = now;
      return session;
    }

    const newId = sessionId || crypto.randomUUID();
    const newSession: McpSession = {
      id: newId,
      createdAt: now,
      lastActiveAt: now,
      initialized: false,
    };
    this.sessions.set(newId, newSession);
    return newSession;
  }

  get(sessionId: string): McpSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
    }
    return session;
  }

  private pruneStaleSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

// ==========================================
// Household Tool Definitions
// ==========================================

const TOOLS: ToolDefinition[] = [
  {
    name: "get_household_digest",
    description: "Get a natural language summary of household activity, active alerts, package deliveries, and device statuses.",
    inputSchema: {
      type: "object",
      properties: {
        timeframe_hours: {
          type: "number",
          description: "Number of preceding hours to summarize (default: 4)",
        },
        include_alerts_only: {
          type: "boolean",
          description: "If true, only return unacknowledged warnings or critical events",
        },
      },
    },
  },
  {
    name: "query_security_events",
    description: "Query recent security activity, Ring doorbell rings, motion events, or door lock logs.",
    inputSchema: {
      type: "object",
      properties: {
        event_type: {
          type: "string",
          enum: ["motion", "doorbell_ring", "access_denied", "all"],
          description: "Category of security event to inspect",
        },
        max_results: {
          type: "number",
          description: "Maximum number of events to return (default: 5)",
        },
      },
    },
  },
  {
    name: "execute_device_action",
    description: "Control smart home devices such as smart locks, interior/exterior lighting, or climate controls.",
    inputSchema: {
      type: "object",
      properties: {
        target_entity: {
          type: "string",
          description: "Device identifier or location name (e.g., 'front_door_lock', 'porch_light', 'thermostat')",
        },
        action: {
          type: "string",
          description: "Action to perform (e.g., 'lock', 'unlock', 'turn_on', 'turn_off', 'set_temperature')",
        },
        value: {
          type: ["string", "number"],
          description: "Optional action parameter (e.g., 72 for temperature, '70%' for brightness)",
        },
      },
      required: ["target_entity", "action"],
    },
  },
  {
    name: "schedule_family_reminder",
    description: "Schedule a contextual family reminder or task announced through smart speakers and visual displays.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Content of the reminder or task",
        },
        assigned_to: {
          type: "string",
          description: "Name of the family member or household role",
        },
        trigger_time: {
          type: "string",
          description: "ISO-8601 timestamp or natural time expression (e.g., '19:00', 'in 30 minutes')",
        },
      },
      required: ["description", "trigger_time"],
    },
  },
];

// ==========================================
// Tool Execution Handlers
// ==========================================

async function executeTool(name: string, args: Record<string, any> = {}): Promise<any> {
  switch (name) {
    case "get_household_digest": {
      const hours = args.timeframe_hours || 4;
      const alertsOnly = Boolean(args.include_alerts_only);

      if (alertsOnly) {
        return {
          content: [
            {
              type: "text",
              text: "No active security or hazard alerts. All perimeter doors are locked.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Household summary for the past ${hours} hours: 1 package delivered at the front door (Ring Doorbell, 42 min ago). Front door locked. Living room thermostat set to 71°F. All family members are marked present.`,
          },
        ],
      };
    }

    case "query_security_events": {
      const eventType = args.event_type || "all";
      const limit = args.max_results || 5;

      const mockEvents = [
        {
          timestamp: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
          type: "doorbell_ring",
          source: "Front Door",
          summary: "Delivery driver rang bell and placed package on welcome mat.",
        },
        {
          timestamp: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
          type: "motion",
          source: "Backyard Camera",
          summary: "Backyard motion detected (identified as neighbor's dog along fence).",
        },
        {
          timestamp: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
          type: "access_denied",
          source: "Side Garage Lock",
          summary: "Keypad PIN attempt failed (1 attempt).",
        },
      ];

      const filtered = eventType === "all" 
        ? mockEvents 
        : mockEvents.filter((e) => e.type === eventType);

      const returned = filtered.slice(0, limit);

      const textResponse = returned.length > 0
        ? returned.map((e) => `[${e.timestamp}] (${e.source}) ${e.summary}`).join("\n")
        : `No ${eventType} events found in the requested range.`;

      return {
        content: [
          {
            type: "text",
            text: textResponse,
          },
        ],
        data: returned,
      };
    }

    case "execute_device_action": {
      const { target_entity, action, value } = args;
      const valueSuffix = value !== undefined ? ` with value '${value}'` : "";

      return {
        content: [
          {
            type: "text",
            text: `Confirmed: Executed action '${action}' on '${target_entity}'${valueSuffix}. Current state: Active.`,
          },
        ],
      };
    }

    case "schedule_family_reminder": {
      const { description, assigned_to, trigger_time } = args;
      const reminderId = `rem_${crypto.randomBytes(4).toString("hex")}`;
      const targetUser = assigned_to ? ` for ${assigned_to}` : "";

      return {
        content: [
          {
            type: "text",
            text: `Scheduled reminder [${reminderId}]${targetUser}: "${description}" set for ${trigger_time}.`,
          },
        ],
      };
    }

    default:
      throw {
        code: -32601,
        message: `Tool not found: '${name}'`,
      };
  }
}

// ==========================================
// Express Application & MCP Server
// ==========================================

const app = express();
const sessionStore = new SessionStore(60);

app.use(express.json());

// CORS Configuration
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", protocol: "MCP Streamable HTTP", version: "2025-11-25" });
});

// MCP Streamable HTTP Endpoint
app.post("/mcp", async (req: Request, res: Response): Promise<any> => {
  const acceptHeader = req.headers["accept"] || "";

  // 1. Validate MCP Streamable HTTP Accept Header
  const acceptsJson = acceptHeader.includes("application/json");
  const acceptsSse = acceptHeader.includes("text/event-stream");

  if (!acceptsJson && !acceptsSse && acceptHeader !== "*/*") {
    return res.status(406).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Not Acceptable: Client must accept application/json or text/event-stream",
      },
      id: null,
    });
  }

  // 2. Session Resolution
  const incomingSessionId = (req.headers["mcp-session-id"] as string) || (req.query.sessionId as string);
  const session = sessionStore.getOrCreate(incomingSessionId);
  res.setHeader("mcp-session-id", session.id);

  // 3. Parse JSON-RPC Payload
  const payload: JsonRpcRequest = req.body;

  if (!payload || typeof payload !== "object" || payload.jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Invalid Request: Must be a JSON-RPC 2.0 object",
      },
    });
  }

  const { id, method, params } = payload;
  const isNotification = id === undefined || id === null;

  // 4. JSON-RPC Method Dispatcher
  try {
    let result: any = null;

    switch (method) {
      case "initialize": {
        session.initialized = true;
        if (params?.clientInfo) {
          session.clientInfo = params.clientInfo;
        }

        result = {
          protocolVersion: "2025-11-25",
          capabilities: {
            tools: {
              listChanged: false,
            },
            logging: {},
          },
          serverInfo: {
            name: "alexa-household-mcp-server",
            version: "1.0.0",
          },
        };
        break;
      }

      case "notifications/initialized": {
        if (isNotification) {
          return res.status(204).end();
        }
        return res.json({ jsonrpc: "2.0", id, result: {} });
      }

      case "ping": {
        result = {};
        break;
      }

      case "tools/list": {
        result = {
          tools: TOOLS,
        };
        break;
      }

      case "tools/call": {
        if (!params?.name || typeof params.name !== "string") {
          return res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid params: 'name' is required for tools/call",
            },
          });
        }

        // Support Streamable SSE response if client specifically requested it
        if (acceptsSse && !acceptsJson) {
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          const toolResult = await executeTool(params.name, params.arguments);
          const responseBody: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: id ?? null,
            result: toolResult,
          };

          res.write(`data: ${JSON.stringify(responseBody)}\n\n`);
          return res.end();
        }

        result = await executeTool(params.name, params.arguments);
        break;
      }

      default: {
        return res.status(404).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: '${method}'`,
          },
        });
      }
    }

    if (isNotification) {
      return res.status(204).end();
    }

    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    return res.status(200).json(response);
  } catch (err: any) {
    const errorCode = err.code && typeof err.code === "number" ? err.code : -32603;
    const errorMessage = err.message || "Internal server error during tool execution";

    if (isNotification) {
      return res.status(204).end();
    }

    return res.status(500).json({
      jsonrpc: "2.0",
      id,
      error: {
        code: errorCode,
        message: errorMessage,
        data: err.data,
      },
    });
  }
});

// ==========================================
// Start Server
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[MCP Server] Alexa+ Streamable HTTP MCP Server listening on port ${PORT}`);
  console.log(`[MCP Server] Endpoint: POST http://localhost:${PORT}/mcp`);
});
