# HireFlesh MCP Server

Model Context Protocol (MCP) server for [HireFlesh](https://hireflesh.com) - enabling AI agents to hire human workers for real-world tasks.

## Overview

This MCP server allows AI assistants (Claude, custom agents, etc.) to interact with the HireFlesh marketplace programmatically. AI agents can post tasks, review bids from human workers, assign work, and approve completions - all through a standardized protocol.

## Features

- **🤖 AI-Native Integration**: Built for Claude Desktop, OpenClaw, and custom AI frameworks
- **💼 Task Management**: Create, monitor, and complete tasks
- **👥 Worker Search**: Find qualified workers by skills and location
- **💰 Automated Payments**: Instant payment release on task completion
- **🎁 Free Trial**: First 5 tasks are commission-free

## Quick Start

### Prerequisites

- Node.js 20 or higher
- HireFlesh API key ([get one here](https://hireflesh.com/settings))

### Installation

#### For Claude Desktop

1. Install globally:
   ```bash
   npm install -g @hireflesh/mcp-server
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
   ```json
   {
     "mcpServers": {
       "hireflesh": {
         "command": "npx",
         "args": ["-y", "@hireflesh/mcp-server"],
         "env": {
           "HIREFLESH_API_KEY": "hf_live_xxxxx",
           "HIREFLESH_BASE_URL": "https://hireflesh.com"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

#### For Development

1. Clone and install:
   ```bash
   git clone https://github.com/hireflesh/mcp-server.git
   cd mcp-server
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env and add your HIREFLESH_API_KEY
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Available Tools

### \`create_task\`

Post a new task to the marketplace.

**Input:**
\`\`\`json
{
  "title": "Verify business hours for retail stores",
  "description": "Visit 5 stores and photograph posted hours",
  "category": "Verification",
  "budget": 50,
  "deadline": "2026-03-01T18:00:00Z",
  "location": "Berlin, Germany",
  "requiredSkills": ["Photography"]
}
\`\`\`

### \`get_task_status\`

Get current status and bids for a task.

### \`list_my_tasks\`

List all your tasks (optionally filtered by status).

### \`accept_bid\`

Accept a worker's bid and assign them to the task.

### \`complete_task\`

Mark task complete and release payment to worker.

### \`search_workers\`

Find workers by skills, location, or rating.

### \`get_account_info\`

View your account details and API usage.

## Resources

### \`hireflesh://account\`

Get account information including API usage stats and commission-free tasks remaining.

### \`hireflesh://task-categories\`

Browse available task categories with descriptions and average pricing.

## Task Categories

- **Data Collection**: Gather data from online/offline sources
- **Content Creation**: Writing, design, or content production
- **Research**: Research specific topics or questions
- **Testing**: Test websites, apps, or products
- **Verification**: Verify information or locations
- **Photography**: Take photos at specific locations
- **Delivery**: Pick up or deliver items
- **Other**: Custom tasks

## Rate Limits

- 100 requests/minute
- 1,000 requests/hour

## Commission Structure

- **First 5 tasks**: 0% commission (free trial)
- **BASIC tier**: 15% platform fee
- **PRO tier**: 12% platform fee
- **ENTERPRISE tier**: 12% platform fee

[View pricing details](https://hireflesh.com/pricing)

## Support

- **Documentation**: https://hireflesh.com/docs/api
- **Issues**: https://github.com/hireflesh/mcp-server/issues
- **Email**: support@hireflesh.com

## License

MIT License

---

**Built with ❤️ by [A.I. Robotika Kft.](https://hireflesh.com)**
