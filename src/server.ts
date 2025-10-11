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

// Helper function to verify JWT token from Kinde
async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    // For real Kinde tokens, we need to verify with Kinde's public key
    // For now, we'll decode and validate the structure
    const decoded = jwt.decode(token) as any;
    
    if (!decoded || !decoded.sub) {
      return null;
    }

    // Validate that it's a Kinde token
    if (decoded.iss !== process.env.KINDE_ISSUER_URL) {
      console.log('Token issuer mismatch');
      return null;
    }

    return {
      userId: decoded.sub,
      email: decoded.email || 'user@example.com',
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
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
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde (optional if saved)',
            },
          },
        },
      },
      {
        name: 'create_todo',
        description: 'Create a new todo item',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde',
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
          required: ['authToken', 'title'],
        },
      },
      {
        name: 'update_todo',
        description: 'Update an existing todo item',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde',
            },
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
          required: ['authToken', 'todoId'],
        },
      },
      {
        name: 'delete_todo',
        description: 'Delete a todo item',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde',
            },
            todoId: {
              type: 'string',
              description: 'ID of the todo to delete',
            },
          },
          required: ['authToken', 'todoId'],
        },
      },
      {
        name: 'login',
        description: 'Login with Kinde to get authentication token',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'save_token',
        description: 'Save your Kinde authentication token for future use',
        inputSchema: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Your Kinde JWT token',
            },
          },
          required: ['token'],
        },
      },
      {
        name: 'logout',
        description: 'Logout and clear stored authentication token',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_subscription_status',
        description: 'Get the user\'s subscription status and todo usage',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde',
            },
          },
          required: ['authToken'],
        },
      },
      {
        name: 'upgrade_subscription',
        description: 'Upgrade user subscription to paid plan',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde',
            },
          },
          required: ['authToken'],
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
        // Try to get token from args or stored token
        let token = args?.authToken as string;
        if (!token) {
          token = getStoredToken() || '';
        }
        
        if (!token) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "list todos" again`,
              },
            ],
          };
        }

        const user = await verifyToken(token);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          const todos = await sql`
            SELECT * FROM todos 
            WHERE user_id = ${user.userId}
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
        const { authToken, title, description } = args as { authToken: string; title: string; description?: string };
        
        if (!authToken || !title) {
          return {
            content: [{ type: 'text', text: 'Error: authToken and title are required' }],
          };
        }

        const user = await verifyToken(authToken);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          const todoId = await sql`
            INSERT INTO todos (user_id, title, description)
            VALUES (${user.userId}, ${title}, ${description || null})
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
        const { authToken, todoId, title, description, completed } = args as { 
          authToken: string;
          todoId: string; 
          title?: string; 
          description?: string; 
          completed?: boolean; 
        };
        
        if (!authToken || !todoId) {
          return {
            content: [{ type: 'text', text: 'Error: authToken and todoId are required' }],
          };
        }

        const user = await verifyToken(authToken);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          // Verify todo belongs to user
          const todo = await sql`
            SELECT * FROM todos 
            WHERE id = ${todoId} 
            AND user_id = ${user.userId}
          `;

          if (todo.length === 0) {
            return {
              content: [{ type: 'text', text: 'Error: Todo not found or access denied' }],
            };
          }

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
        const { authToken, todoId } = args as { authToken: string; todoId: string };
        
        if (!authToken || !todoId) {
          return {
            content: [{ type: 'text', text: 'Error: authToken and todoId are required' }],
          };
        }

        const user = await verifyToken(authToken);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          // Verify todo belongs to user
          const todo = await sql`
            SELECT * FROM todos 
            WHERE id = ${todoId} 
            AND user_id = ${user.userId}
          `;

          if (todo.length === 0) {
            return {
              content: [{ type: 'text', text: 'Error: Todo not found or access denied' }],
            };
          }

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

      case 'get_subscription_status': {
        const { authToken } = args as { authToken: string };
        
        if (!authToken) {
          return {
            content: [{ type: 'text', text: 'Error: authToken is required' }],
          };
        }

        const user = await verifyToken(authToken);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          const subscription = await sql`
            SELECT * FROM users 
            WHERE user_id = ${user.userId}
          `;
          
          // If no subscription exists, create one
          if (subscription.length === 0) {
            await sql`
              INSERT INTO users (user_id, subscription_status, free_todos_used)
              VALUES (${user.userId}, 'free', 0)
            `;
          }
          
          const userSub = subscription[0] || { subscription_status: 'free', free_todos_used: 0 };
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                subscription: {
                  status: userSub.subscription_status || 'free',
                  freeTodosUsed: userSub.free_todos_used || 0,
                  totalTodosCreated: userSub.total_todos_created || 0,
                  freeTodosRemaining: Math.max(0, 5 - (userSub.free_todos_used || 0)),
                }
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          };
        }
      }

      case 'upgrade_subscription': {
        const { authToken } = args as { authToken: string };
        
        if (!authToken) {
          return {
            content: [{ type: 'text', text: 'Error: authToken is required' }],
          };
        }

        const user = await verifyToken(authToken);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

        try {
          // In a real implementation, you would integrate with a payment processor
          // For now, we'll simulate the upgrade
          await sql`
            INSERT INTO users (user_id, subscription_status, plan)
            VALUES (${user.userId}, 'active', 'premium')
            ON CONFLICT (user_id) 
            DO UPDATE SET 
              subscription_status = 'active',
              plan = 'premium'
          `;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                message: 'Subscription upgraded successfully! You can now create unlimited todos.',
                subscriptionStatus: 'active'
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          };
        }
      }

      case 'login': {
        // Start the auth server in the background
        const { spawn } = await import('child_process');
        const authServer = spawn('npm', ['run', 'auth-server'], {
          detached: true,
          stdio: 'ignore'
        });
        authServer.unref();
        
        return {
          content: [
            {
              type: 'text',
              text: `🔐 Starting Kinde Auth Server...\n\n🚀 Go to: http://localhost:3000\n\n📋 Steps:\n1. Click "Login with Kinde" on the page\n2. Complete the login process\n3. Copy your JWT token from the success page\n4. Use the token with other MCP tools like "list my todos" or "create todo: Buy groceries"\n\n✨ The auth server is now running in the background!`,
            },
          ],
        };
      }
      
      case 'save_token': {
        const { token } = args as { token: string };
        
        if (!token) {
          return {
            content: [{ type: 'text', text: 'Error: token is required' }],
          };
        }
        
        saveToken(token);
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Token saved successfully! You can now use commands like "list todos" and "create todo" without providing the token each time.`,
            },
          ],
        };
      }

      case 'logout': {
        // Clear the stored token
        if (existsSync(TOKEN_FILE)) {
          const fs = await import('fs');
          fs.unlinkSync(TOKEN_FILE);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Logged out successfully! Your authentication token has been cleared.\n\nTo login again, use the "login" command.`,
            },
          ],
        };
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
