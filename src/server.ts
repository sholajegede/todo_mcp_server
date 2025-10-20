import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
// @ts-ignore
import JwksClient from 'jwks-client';
import dotenv from 'dotenv';
import { createKindeServerClient, GrantType, SessionManager } from '@kinde-oss/kinde-typescript-sdk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
dotenv.config();

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

// Initialize Neon PostgreSQL
const sql = neon(process.env.DATABASE_URL!);

// Initialize JWKS client for Kinde token verification
const client = JwksClient({
  jwksUri: `${process.env.KINDE_ISSUER_URL}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
});

// Create Kinde client for authentication
const kindeClient = createKindeServerClient(GrantType.AUTHORIZATION_CODE, {
  authDomain: process.env.KINDE_ISSUER_URL!,
  clientId: process.env.KINDE_CLIENT_ID!,
  clientSecret: process.env.KINDE_CLIENT_SECRET!,
  redirectURL: 'http://localhost:3000/callback',
  logoutRedirectURL: 'http://localhost:3000',
});

// Simple session manager for Kinde - use a shared session store
const sessionStore: Record<string, any> = {};

const createSessionManager = (): SessionManager => ({
  getSessionItem: async (key: string) => {
    return sessionStore[key] || null;
  },
  setSessionItem: async (key: string, value: any) => {
    sessionStore[key] = value;
  },
  removeSessionItem: async (key: string) => {
    delete sessionStore[key];
  },
  destroySession: async () => {
    Object.keys(sessionStore).forEach(key => delete sessionStore[key]);
  }
});

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

// Helper function to get Kinde billing status
async function getKindeBillingStatus(userId: string, accessToken: string): Promise<{ plan: string; features: any; canCreate: boolean; reason?: string }> {
  try {
    // Decode JWT token to get user information
    const decoded = jwt.decode(accessToken) as any;
    console.log('🔍 JWT Token data for user:', userId, 'Decoded:', decoded);
    
    // Check local database for free tier usage only
    const subscription = await sql`
      SELECT * FROM users 
      WHERE user_id = ${userId}
    `;

    // If user doesn't exist, create them with details from JWT
    if (subscription.length === 0) {
      await sql`
        INSERT INTO users (user_id, name, email, subscription_status, plan, free_todos_used)
        VALUES (${userId}, ${decoded.given_name || decoded.name || 'User'}, ${decoded.email || 'user@example.com'}, 'free', 'free', 0)
      `;
      console.log('👤 New user created:', decoded.given_name || decoded.name, decoded.email);
    }

    // Check if user has used all free todos (1 todo limit for testing)
    const freeTodosUsed = subscription.length > 0 ? subscription[0].free_todos_used : 0;
    
    if (freeTodosUsed < 1) {
      return {
        plan: 'free',
        features: { maxTodos: 1, used: freeTodosUsed },
        canCreate: true,
        reason: `Free tier - ${1 - freeTodosUsed} todo remaining`
      };
    }
    
    return {
      plan: 'free',
      features: { maxTodos: 1, used: freeTodosUsed },
      canCreate: false,
      reason: 'You have used your free todo. Please upgrade your plan at https://learnflowai.kinde.com/portal to create more todos.'
    };
  } catch (error) {
    console.error('Error checking Kinde billing:', error);
    return {
      plan: 'free',
      features: { maxTodos: 1 },
      canCreate: false,
      reason: 'Error checking billing status'
    };
  }
}

// Helper function to check if user can create more todos
async function canCreateTodo(userId: string, accessToken?: string): Promise<{ canCreate: boolean; reason?: string }> {
  try {
    if (accessToken) {
      const billingStatus = await getKindeBillingStatus(userId, accessToken);
      return {
        canCreate: billingStatus.canCreate,
        reason: billingStatus.reason
      };
    }

    // Fallback to local database check
    const subscription = await sql`
      SELECT * FROM users 
      WHERE user_id = ${userId}
    `;

    if (subscription.length === 0) {
      return { canCreate: true };
    }

    const userSub = subscription[0];
    
    if (userSub.subscription_status === 'active') {
      return { canCreate: true };
    }
    
    if (userSub.free_todos_used < 5) {
      return { canCreate: true };
    }
    
    return { 
      canCreate: false, 
      reason: 'You have used all 5 free todos. Please upgrade to create more todos.' 
    };
  } catch (error) {
    console.error('Error checking subscription:', error);
    return { canCreate: false, reason: 'Error checking subscription status' };
  }
}

// Helper function to validate arguments
function validateArgs(args: any, requiredFields: string[]): { valid: boolean; error?: string; validatedArgs?: any } {
  if (!args) {
    return { valid: false, error: 'Missing arguments' };
  }
  
  for (const field of requiredFields) {
    if (!args[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }
  
  return { valid: true, validatedArgs: args };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
      {
        name: 'create_todo',
        description: 'Create a new todo item with interactive prompts',
        inputSchema: {
          type: 'object',
          properties: {
            authToken: {
              type: 'string',
              description: 'Authentication token from Kinde (optional if saved)',
            },
            title: {
              type: 'string',
              description: 'Title of the todo item',
            },
            description: {
              type: 'string',
              description: 'Optional description of the todo item',
            },
            completed: {
              type: 'boolean',
              description: 'Completion status of the todo',
            },
          },
        },
      },
      {
        name: 'update_todo',
        description: 'Update an existing todo item with interactive prompts',
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
        name: 'delete_todo',
        description: 'Delete a todo item with interactive prompts',
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
        name: 'logout',
        description: 'Logout and clear stored authentication token',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
        {
          name: 'get_kinde_billing',
          description: 'Get Kinde billing information and subscription status',
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
          name: 'refresh_billing_status',
          description: 'Force refresh billing status from Kinde (useful after plan changes)',
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
          name: 'logout',
          description: 'Logout and clear stored authentication token',
          inputSchema: {
            type: 'object',
            properties: {},
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
        const validation = validateArgs(args, ['token']);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Error: ${validation.error}` }],
          };
        }
        
        const token = validation.validatedArgs!.token as string;
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

        const todos = await sql`
          SELECT * FROM todos 
          WHERE user_id = ${user.userId}
          ORDER BY created_at DESC
        `;

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, todos }, null, 2) }],
        };
      }




      case 'get_subscription_status': {
        const validation = validateArgs(args, ['authToken']);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Error: ${validation.error}` }],
          };
        }

        const user = await verifyToken(validation.validatedArgs!.authToken as string);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

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
      }

      case 'upgrade_subscription': {
        const validation = validateArgs(args, ['authToken']);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Error: ${validation.error}` }],
          };
        }

        const user = await verifyToken(validation.validatedArgs!.authToken as string);
        if (!user) {
          return {
            content: [{ type: 'text', text: 'Error: Invalid authentication token' }],
          };
        }

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
      }

      case 'create_todo': {
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
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "create todo" again`,
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

        // If title is provided, create the todo
        if (args?.title) {
          // Check if user can create more todos
          const { canCreate, reason } = await canCreateTodo(user.userId);
          if (!canCreate) {
            return {
              content: [{
                type: 'text',
                text: `🚫 You have used up all your free todos.\n\n💳 Upgrade your plan to create more todos:\n🔗 https://learnflowai.kinde.com/portal`
              }],
            };
          }

          const todoId = await sql`
            INSERT INTO todos (user_id, title, description, completed)
            VALUES (${user.userId}, ${args.title as string}, ${args.description as string || null}, ${args.completed as boolean || false})
            RETURNING id
          `;

          // Update user's todo count
          await sql`
            INSERT INTO users (user_id, free_todos_used)
            VALUES (${user.userId}, 1)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
              free_todos_used = users.free_todos_used + 1
          `;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ 
                success: true, 
                todoId: todoId[0].id,
                message: 'Todo created successfully',
                title: args.title,
                description: args.description,
                completed: args.completed || false
              }, null, 2)
            }],
          };
        }

        // If no title provided, ask for details
        return {
          content: [
            {
              type: 'text',
              text: `📝 **Create New Todo**\n\nPlease provide the following details:\n\n1. **Title**: What is the title of your todo?\n2. **Description**: (Optional) What is the description?\n3. **Completed**: (Optional) Is it completed? (true/false)\n\nPlease respond with your answers in this format:\n\`\`\`\ntitle: Your todo title\ndescription: Your description (optional)\ncompleted: false (optional)\n\`\`\``,
            },
          ],
        };
      }

      case 'update_todo': {
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
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "update todo" again`,
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

        // Get user's todos to show them
        const todos = await sql`
          SELECT * FROM todos 
          WHERE user_id = ${user.userId}
          ORDER BY created_at DESC
        `;

        if (todos.length === 0) {
          return {
            content: [{ type: 'text', text: '❌ No todos found. Create a todo first!' }],
          };
        }

        let todoList = '📋 **Your Todos:**\n\n';
        todos.forEach((todo, index) => {
          todoList += `${index + 1}. **ID: ${todo.id}** - ${todo.title}\n`;
          if (todo.description) todoList += `   Description: ${todo.description}\n`;
          todoList += `   Status: ${todo.completed ? '✅ Completed' : '⏳ Pending'}\n\n`;
        });

        return {
          content: [
            {
              type: 'text',
              text: `${todoList}**Which todo would you like to update?**\n\nPlease respond with the todo ID and new details in this format:\n\`\`\`\ntodoId: 1\ntitle: New title (optional)\ndescription: New description (optional)\ncompleted: true (optional)\n\`\`\``,
            },
          ],
        };
      }

      case 'delete_todo': {
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
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "delete todo" again`,
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

        // Get user's todos to show them
        const todos = await sql`
          SELECT * FROM todos 
          WHERE user_id = ${user.userId}
          ORDER BY created_at DESC
        `;

        if (todos.length === 0) {
          return {
            content: [{ type: 'text', text: '❌ No todos found. Create a todo first!' }],
          };
        }

        let todoList = '📋 **Your Todos:**\n\n';
        todos.forEach((todo, index) => {
          todoList += `${index + 1}. **ID: ${todo.id}** - ${todo.title}\n`;
          if (todo.description) todoList += `   Description: ${todo.description}\n`;
          todoList += `   Status: ${todo.completed ? '✅ Completed' : '⏳ Pending'}\n\n`;
        });

        return {
          content: [
            {
              type: 'text',
              text: `${todoList}**Which todo would you like to delete?**\n\nPlease respond with the todo ID:\n\`\`\`\ntodoId: 1\n\`\`\``,
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

      case 'get_kinde_billing': {
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
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "get kinde billing" again`,
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
          const billingStatus = await getKindeBillingStatus(user.userId, token);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                kindeBilling: {
                  plan: billingStatus.plan,
                  features: billingStatus.features,
                  canCreate: billingStatus.canCreate,
                  reason: billingStatus.reason,
                  upgradeUrl: `https://${process.env.KINDE_ISSUER_URL?.replace('https://', '')}/portal`,
                  selfServicePortal: `https://${process.env.KINDE_ISSUER_URL?.replace('https://', '')}/portal`
                }
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Failed to fetch Kinde billing information',
                details: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
          };
        }
      }

      case 'refresh_billing_status': {
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
                text: `❌ No authentication token found. Please:\n1. Type "login" to get the authentication URL\n2. Complete login at http://localhost:3000\n3. Copy your token and use "save_token" to store it\n4. Then try "refresh billing status" again`,
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
          console.log('🔄 Force refreshing billing status for user:', user.userId);
          const billingStatus = await getKindeBillingStatus(user.userId, token);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Billing status refreshed successfully!',
                kindeBilling: {
                  plan: billingStatus.plan,
                  features: billingStatus.features,
                  canCreate: billingStatus.canCreate,
                  reason: billingStatus.reason,
                  upgradeUrl: `https://${process.env.KINDE_ISSUER_URL?.replace('https://', '')}/portal`,
                  selfServicePortal: `https://${process.env.KINDE_ISSUER_URL?.replace('https://', '')}/portal`,
                  lastChecked: new Date().toISOString()
                }
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Failed to refresh billing information',
                details: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
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
