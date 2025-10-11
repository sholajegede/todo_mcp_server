import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Neon PostgreSQL
const sql = neon(process.env.DATABASE_URL!);

// Create MCP server
const server = new Server(
  {
    name: 'todo-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'hello',
        description: 'Say hello to the MCP server',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_todos',
        description: 'List all todos for the authenticated user',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to list todos for',
            },
          },
          required: ['userId'],
        },
      },
      {
        name: 'create_todo',
        description: 'Create a new todo item',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to create todo for',
            },
            title: {
              type: 'string',
              description: 'Title of the todo item',
            },
            description: {
              type: 'string',
              description: 'Optional description of the todo item',
            },
          },
          required: ['userId', 'title'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'hello': {
        return {
          content: [
            {
              type: 'text',
              text: 'Hello! Welcome to the Todo MCP Server! 🚀',
            },
          ],
        };
      }

      case 'list_todos': {
        const { userId } = args as { userId: string };
        
        if (!userId) {
          return {
            content: [{ type: 'text', text: 'Error: userId is required' }],
          };
        }

        try {
          const todos = await sql`
            SELECT * FROM todos 
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
          `;

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, todos }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          };
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }],
        };
    }
  } catch (error) {
    console.error('Error handling tool call:', error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ 
          success: false, 
          error: 'Internal server error' 
        }, null, 2)
      }],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Todo MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
