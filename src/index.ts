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

dotenv.config();

const API_KEY = process.env.HIREFLESH_API_KEY;
const BASE_URL = process.env.HIREFLESH_BASE_URL || "https://hireflesh.com";

if (!API_KEY) {
  console.error("Error: HIREFLESH_API_KEY environment variable is required");
  process.exit(1);
}

// API client helper
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${BASE_URL}/api/v1${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
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
