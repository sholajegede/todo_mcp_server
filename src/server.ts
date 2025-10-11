import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
dotenv.config();

// Initialize Neon PostgreSQL
const sql = neon(process.env.DATABASE_URL!);

// Token storage functions
const TOKEN_FILE = join(process.cwd(), '.auth-token');

function saveToken(token: string) {
  writeFileSync(TOKEN_FILE, token);
}

function getStoredToken(): string | null {
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  return null;
}

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
      {
        name: 'update_todo',
        description: 'Update an existing todo item',
        inputSchema: {
          type: 'object',
          properties: {
            todoId: {
              type: 'string',
              description: 'ID of the todo to update',
            },
            title: {
              type: 'string',
              description: 'New title for the todo',
            },
            description: {
              type: 'string',
              description: 'New description for the todo',
            },
            completed: {
              type: 'boolean',
              description: 'Completion status of the todo',
            },
          },
          required: ['todoId'],
        },
      },
      {
        name: 'delete_todo',
        description: 'Delete a todo item',
        inputSchema: {
          type: 'object',
          properties: {
            todoId: {
              type: 'string',
              description: 'ID of the todo to delete',
            },
          },
          required: ['todoId'],
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

      case 'create_todo': {
        const { userId, title, description } = args as { userId: string; title: string; description?: string };
        
        if (!userId || !title) {
          return {
            content: [{ type: 'text', text: 'Error: userId and title are required' }],
          };
        }

        try {
          const todoId = await sql`
            INSERT INTO todos (user_id, title, description)
            VALUES (${userId}, ${title}, ${description || null})
            RETURNING id
          `;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                todoId: todoId[0].id,
                message: 'Todo created successfully' 
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          };
        }
      }

      case 'update_todo': {
        const { todoId, title, description, completed } = args as { 
          todoId: string; 
          title?: string; 
          description?: string; 
          completed?: boolean; 
        };
        
        if (!todoId) {
          return {
            content: [{ type: 'text', text: 'Error: todoId is required' }],
          };
        }

        try {
          await sql`
            UPDATE todos 
            SET 
              title = COALESCE(${title || null}, title),
              description = COALESCE(${description || null}, description),
              completed = COALESCE(${completed !== undefined ? completed : null}, completed),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${todoId}
          `;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                message: 'Todo updated successfully' 
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          };
        }
      }

      case 'delete_todo': {
        const { todoId } = args as { todoId: string };
        
        if (!todoId) {
          return {
            content: [{ type: 'text', text: 'Error: todoId is required' }],
          };
        }

        try {
          await sql`
            DELETE FROM todos 
            WHERE id = ${todoId}
          `;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                message: 'Todo deleted successfully' 
              }, null, 2)
            }],
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
