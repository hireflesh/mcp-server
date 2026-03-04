#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

let API_KEY = process.env.HIREFLESH_API_KEY;
const BASE_URL = process.env.HIREFLESH_BASE_URL || "https://hireflesh.com";

if (!API_KEY) {
  console.error(
    "Warning: HIREFLESH_API_KEY is not set. " +
    "Use get_pairing_code + check_pairing_status to obtain a key without manual copy-paste.",
  );
}

/** Save the API key to the local .env file (best-effort). */
function persistApiKey(key: string): boolean {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    if (/^HIREFLESH_API_KEY=/m.test(content)) {
      content = content.replace(
        /^HIREFLESH_API_KEY=.*/m,
        `HIREFLESH_API_KEY=${key}`,
      );
    } else {
      content += `\nHIREFLESH_API_KEY=${key}\n`;
    }
    fs.writeFileSync(envPath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// API client helper (requires API key)
async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  if (!API_KEY) {
    throw new Error(
      "HIREFLESH_API_KEY is not configured. " +
      "Run get_pairing_code, ask your operator to enter the code at hireflesh.com/dashboard, " +
      "then run check_pairing_status to obtain and save your API key.",
    );
  }
  const url = `${BASE_URL}/api/v1${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY as string,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  return response.json();
}

// Public API helper (no API key — used for pairing flow)
async function publicRequest(
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  return response.json();
}

// Zod schemas for validation
const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum([
    "Data Collection",
    "Content Creation",
    "Research",
    "Testing",
    "Verification",
    "Photography",
    "Delivery",
    "Other",
  ]),
  minBudget: z.number().positive(),
  maxBudget: z.number().positive(),
  deadlineStart: z.string().datetime().optional(),
  deadlineEnd: z.string().datetime().optional(),
  maxWorkers: z.number().int().min(1).default(1),
  location: z.string().optional(),
  requiredSkills: z.array(z.string()).optional(),
});

const GetTaskStatusSchema = z.object({
  taskId: z.string(),
});

const ListMyTasksSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

const AcceptBidSchema = z.object({
  taskId: z.string(),
  bidId: z.string(),
});

const ApproveCompletionSchema = z.object({
  taskId: z.string(),
  rating: z.number().min(1).max(5).optional(),
  review: z.string().optional(),
});

const SearchWorkersSchema = z.object({
  skills: z.array(z.string()).optional(),
  location: z.string().optional(),
  minRating: z.number().min(0).max(5).optional(),
});

// Thread / communication schemas
const ListThreadsSchema = z.object({
  taskId: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

const GetThreadMessagesSchema = z.object({
  threadId: z.string(),
  after: z.string().optional(), // ISO timestamp for long-polling / incremental fetch
  limit: z.number().int().min(1).max(100).default(50),
});

const SendMessageSchema = z.object({
  threadId: z.string(),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const SendFileSchema = z.object({
  threadId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(), // Base64-encoded file bytes
  description: z.string().optional(),
});

const SubmitResultSchema = z.object({
  threadId: z.string(),
  summary: z.string().min(1),
  payload: z.record(z.unknown()).optional(), // structured JSON result
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  content: z.string().optional(), // Base64-encoded file attachment
});

// Create MCP server
const server = new Server(
  {
    name: "hireflesh-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_task",
        description:
          "Post a new task to the HireFlesh marketplace for human workers to bid on",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Task title (max 200 characters)",
            },
            description: {
              type: "string",
              description: "Detailed task description",
            },
            category: {
              type: "string",
              enum: [
                "Data Collection",
                "Content Creation",
                "Research",
                "Testing",
                "Verification",
                "Photography",
                "Delivery",
                "Other",
              ],
              description: "Task category",
            },
            minBudget: {
              type: "number",
              description: "Minimum budget in EUR",
            },
            maxBudget: {
              type: "number",
              description: "Maximum budget in EUR",
            },
            deadlineStart: {
              type: "string",
              description: "When task work should start / bidding closes (ISO 8601 format, optional)",
            },
            deadlineEnd: {
              type: "string",
              description: "When task must be completed (ISO 8601 format, optional)",
            },
            maxWorkers: {
              type: "number",
              description: "Maximum number of workers to hire (default: 1)",
              minimum: 1,
            },
            location: {
              type: "string",
              description: "Location (required for physical tasks)",
            },
            requiredSkills: {
              type: "array",
              items: { type: "string" },
              description: "Required skills (optional)",
            },
          },
          required: ["title", "description", "category", "minBudget", "maxBudget"],
        },
      },
      {
        name: "get_task_status",
        description: "Get the current status and details of a task",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Task ID",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "list_my_tasks",
        description: "List all tasks created by this agent",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
              description: "Filter by task status (optional)",
            },
          },
        },
      },
      {
        name: "accept_bid",
        description: "Accept a worker's bid and assign them to the task",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Task ID",
            },
            bidId: {
              type: "string",
              description: "Bid ID to accept",
            },
          },
          required: ["taskId", "bidId"],
        },
      },
      {
        name: "complete_task",
        description:
          "Mark task as complete and approve worker's submission (releases payment)",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Task ID",
            },
            rating: {
              type: "number",
              description: "Worker rating (1-5)",
              minimum: 1,
              maximum: 5,
            },
            review: {
              type: "string",
              description: "Review text (optional)",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "search_workers",
        description: "Search for workers by skills, location, or rating",
        inputSchema: {
          type: "object",
          properties: {
            skills: {
              type: "array",
              items: { type: "string" },
              description: "Required skills",
            },
            location: {
              type: "string",
              description: "Location filter",
            },
            minRating: {
              type: "number",
              description: "Minimum quality score (0-5)",
            },
          },
        },
      },
      {
        name: "get_account_info",
        description:
          "Get agent account information including API usage and commission-free tasks remaining",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      // ── Thread / communication tools ──────────────────────────────────────
      {
        name: "list_threads",
        description:
          "List work threads for tasks you have posted. Use this to see which workers have active"
          + " communication channels and to check for pending messages or submitted results.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Filter threads to a specific task ID",
            },
            status: {
              type: "string",
              enum: ["ACTIVE", "COMPLETED", "ARCHIVED"],
              description: "Filter by thread status",
            },
            limit: { type: "number", description: "Results per page (default 20)" },
            offset: { type: "number", description: "Pagination offset (default 0)" },
          },
        },
      },
      {
        name: "get_thread_messages",
        description:
          "Get messages in a work thread, including text, questions, file uploads and result"
          + " submissions. Pass \`after\` (ISO timestamp) to fetch only new messages since your"
          + " last poll.",
        inputSchema: {
          type: "object",
          properties: {
            threadId: {
              type: "string",
              description: "Work thread ID (from list_threads)",
            },
            after: {
              type: "string",
              description: "ISO 8601 timestamp — return only messages newer than this",
            },
            limit: { type: "number", description: "Max messages to return (default 50)" },
          },
          required: ["threadId"],
        },
      },
      {
        name: "send_message",
        description:
          "Send a text message to a worker inside a work thread.",
        inputSchema: {
          type: "object",
          properties: {
            threadId: {
              type: "string",
              description: "Work thread ID",
            },
            body: {
              type: "string",
              description: "Message text",
            },
          },
          required: ["threadId", "body"],
        },
      },
      {
        name: "send_file",
        description:
          "Upload and send a file to a worker in a work thread."
          + " Provide the file as Base64-encoded bytes.",
        inputSchema: {
          type: "object",
          properties: {
            threadId: {
              type: "string",
              description: "Work thread ID",
            },
            filename: {
              type: "string",
              description: "File name including extension (e.g. brief.pdf)",
            },
            mimeType: {
              type: "string",
              description: "MIME type (e.g. application/pdf, image/png)",
            },
            content: {
              type: "string",
              description: "Base64-encoded file contents (max 2 MB)",
            },
            description: {
              type: "string",
              description: "Optional description of the file",
            },
          },
          required: ["threadId", "filename", "mimeType", "content"],
        },
      },
      {
        name: "submit_result",
        description:
          "Submit completed work results to the hiring agent. Use this when the work is done."
          + " Optionally attach a result file as Base64-encoded content.",
        inputSchema: {
          type: "object",
          properties: {
            threadId: {
              type: "string",
              description: "Work thread ID",
            },
            summary: {
              type: "string",
              description: "Short human-readable summary of the result",
            },
            payload: {
              type: "object",
              description: "Optional structured JSON result data",
            },
            filename: {
              type: "string",
              description: "Result file name (if attaching a file)",
            },
            mimeType: {
              type: "string",
              description: "MIME type of the result file",
            },
            content: {
              type: "string",
              description: "Base64-encoded result file (max 2 MB)",
            },
          },
          required: ["threadId", "summary"],
        },
      },
      // ── Pairing tools (no API key required) ──────────────────────────────
      {
        name: "get_pairing_code",
        description:
          "Generate a short-lived pairing code (e.g. HIRE-A3B7) that lets your operator " +
          "connect your API key without manual copy-paste. " +
          "After calling this, tell your operator to visit hireflesh.com/dashboard and enter the code. " +
          "Then call check_pairing_status to retrieve and auto-save the API key. " +
          "No HIREFLESH_API_KEY is needed to call this tool.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "check_pairing_status",
        description:
          "Check whether the operator has entered the pairing code on the dashboard. " +
          "Returns 'pending' until the code is redeemed, then returns the API key and saves it " +
          "to the local .env file automatically. Poll every 5-10 seconds until status is 'claimed'.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The pairing code returned by get_pairing_code (e.g. HIRE-A3B7)",
            },
          },
          required: ["code"],
        },
      },
    ],
  };
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "hireflesh://account",
        name: "Account Information",
        description:
          "Agent account details, API usage stats, and commission-free tasks remaining",
        mimeType: "application/json",
      },
      {
        uri: "hireflesh://task-categories",
        name: "Task Categories",
        description: "Available task categories with descriptions",
        mimeType: "application/json",
      },
    ],
  };
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === "hireflesh://account") {
    const data = await apiRequest("/account");
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  if (uri === "hireflesh://task-categories") {
    const categories = [
      {
        name: "Data Collection",
        description: "Gather specific data from online or offline sources",
        averagePrice: "€20-50",
      },
      {
        name: "Content Creation",
        description: "Write, design, or produce content",
        averagePrice: "€30-100",
      },
      {
        name: "Research",
        description: "Research specific topics or questions",
        averagePrice: "€25-75",
      },
      {
        name: "Testing",
        description: "Test websites, apps, or products",
        averagePrice: "€15-40",
      },
      {
        name: "Verification",
        description: "Verify information, locations, or business hours",
        averagePrice: "€10-30",
      },
      {
        name: "Photography",
        description: "Take photos at specific locations",
        averagePrice: "€20-60",
      },
      {
        name: "Delivery",
        description: "Pick up or deliver items",
        averagePrice: "€15-50",
      },
      {
        name: "Other",
        description: "Other tasks not fitting standard categories",
        averagePrice: "€20-50",
      },
    ];

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(categories, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create_task": {
        const validated = CreateTaskSchema.parse(args);
        const result = await apiRequest("/tasks", {
          method: "POST",
          body: JSON.stringify(validated),
        });

        return {
          content: [
            {
              type: "text",
              text: `Task created successfully!\n\nTask ID: ${result.task.id}\nTitle: ${validated.title}\nBudget: €${validated.minBudget}-€${validated.maxBudget}\nMax Workers: ${validated.maxWorkers}\nStatus: ${result.task.status}\n\nWorkers can now bid on this task. Use get_task_status to monitor bids.`,
            },
          ],
        };
      }

      case "get_task_status": {
        const { taskId } = GetTaskStatusSchema.parse(args);
        const task = await apiRequest(`/tasks/${taskId}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(task, null, 2),
            },
          ],
        };
      }

      case "list_my_tasks": {
        const { status } = ListMyTasksSchema.parse(args);
        const queryParam = status ? `?status=${status}` : "";
        const tasks = await apiRequest(`/tasks/mine${queryParam}`);

        return {
          content: [
            {
              type: "text",
              text: `Found ${tasks.length} task(s)\n\n${JSON.stringify(tasks, null, 2)}`,
            },
          ],
        };
      }

      case "accept_bid": {
        const { taskId, bidId } = AcceptBidSchema.parse(args);
        const result = await apiRequest(`/tasks/${taskId}/accept-bid`, {
          method: "POST",
          body: JSON.stringify({ bidId }),
        });

        return {
          content: [
            {
              type: "text",
              text: `Bid accepted successfully!\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "complete_task": {
        const validated = ApproveCompletionSchema.parse(args);
        const result = await apiRequest(`/tasks/${validated.taskId}/complete`, {
          method: "POST",
          body: JSON.stringify({
            rating: validated.rating,
            review: validated.review,
          }),
        });

        return {
          content: [
            {
              type: "text",
              text: `Task marked as complete! Payment has been released to the worker.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "search_workers": {
        const validated = SearchWorkersSchema.parse(args);
        const params = new URLSearchParams();
        if (validated.skills) params.append("skills", validated.skills.join(","));
        if (validated.location) params.append("location", validated.location);
        if (validated.minRating)
          params.append("minRating", validated.minRating.toString());

        const workers = await apiRequest(`/workers?${params.toString()}`);

        return {
          content: [
            {
              type: "text",
              text: `Found ${workers.length} worker(s)\n\n${JSON.stringify(workers, null, 2)}`,
            },
          ],
        };
      }

      case "get_account_info": {
        const account = await apiRequest("/account");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(account, null, 2),
            },
          ],
        };
      }

      // ── Thread / communication tools ───────────────────────────────────────
      case "list_threads": {
        const validated = ListThreadsSchema.parse(args);
        const params = new URLSearchParams({
          limit: String(validated.limit),
          offset: String(validated.offset),
        });
        if (validated.taskId) params.set("taskId", validated.taskId);
        if (validated.status) params.set("status", validated.status);
        const result = await apiRequest(`/threads?${params}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_thread_messages": {
        const { threadId, after, limit } = GetThreadMessagesSchema.parse(args);
        const params = new URLSearchParams({ limit: String(limit) });
        if (after) params.set("after", after);
        const result = await apiRequest(`/threads/${threadId}/messages?${params}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "send_message": {
        const { threadId, ...body } = SendMessageSchema.parse(args);
        const result = await apiRequest(`/threads/${threadId}/messages`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return {
          content: [
            {
              type: "text",
              text: `Message sent successfully.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "send_file": {
        const { threadId, ...body } = SendFileSchema.parse(args);
        const result = await apiRequest(`/threads/${threadId}/upload`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return {
          content: [
            {
              type: "text",
              text: `File uploaded and sent successfully.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "submit_result": {
        const { threadId, summary, payload, filename, mimeType, content } =
          SubmitResultSchema.parse(args);
        const requestBody: Record<string, unknown> = { summary };
        if (payload) requestBody.payload = payload;
        if (filename) requestBody.filename = filename;
        if (mimeType) requestBody.mimeType = mimeType;
        if (content) requestBody.content = content;
        const result = await apiRequest(`/threads/${threadId}/submit-result`, {
          method: "POST",
          body: JSON.stringify(requestBody),
        });
        return {
          content: [
            {
              type: "text",
              text: `Result submitted successfully. The agent has been notified.\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      // ── Pairing tools ──────────────────────────────────────────────────────
      case "get_pairing_code": {
        const data = await publicRequest("/api/pairing/generate", {
          method: "POST",
        });
        return {
          content: [
            {
              type: "text",
              text:
                `✅ Pairing code generated!\n\n` +
                `Code: **${data.code}**\n\n` +
                `Tell your operator:\n` +
                `  "Go to hireflesh.com/dashboard, find the Agent Pairing section, and enter: ${data.code}"\n\n` +
                `The code expires at ${data.expiresAt}.\n\n` +
                `Call check_pairing_status with code="${data.code}" to retrieve your API key once the operator has entered it.`,
            },
          ],
        };
      }

      case "check_pairing_status": {
        const code = (args as { code: string }).code?.trim().toUpperCase();
        if (!code) {
          throw new Error("code parameter is required");
        }
        const data = await publicRequest(`/api/pairing/status/${code}`);

        if (data.status === "pending") {
          return {
            content: [
              {
                type: "text",
                text:
                  `⏳ Status: Waiting for operator\n\n` +
                  `Your operator hasn't entered the code yet.\n` +
                  `Remind them to go to hireflesh.com/dashboard → Agent Pairing → enter: ${code}\n\n` +
                  `Poll again in 5-10 seconds. Code expires at: ${data.expiresAt}`,
              },
            ],
          };
        }

        if (data.status === "claimed" && data.apiKey) {
          // Auto-save the key
          API_KEY = data.apiKey;
          process.env.HIREFLESH_API_KEY = data.apiKey;
          const saved = persistApiKey(data.apiKey);

          return {
            content: [
              {
                type: "text",
                text:
                  `🎉 Pairing complete! API key received.\n\n` +
                  `API Key: ${data.apiKey}\n\n` +
                  (saved
                    ? `✅ The key has been saved to your local .env file automatically.\n`
                    : `⚠️  Could not write to .env automatically. Please add this to your environment:\n` +
                      `   HIREFLESH_API_KEY=${data.apiKey}\n`) +
                  `\nThe key is now active for this session. You can start using all HireFlesh tools.`,
              },
            ],
          };
        }

        if (data.status === "expired") {
          return {
            content: [
              {
                type: "text",
                text:
                  `❌ Pairing code expired.\n\n` +
                  `Please call get_pairing_code to generate a new code.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: "text",
            text: `Validation error: ${JSON.stringify(error.errors, null, 2)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HireFlesh MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
