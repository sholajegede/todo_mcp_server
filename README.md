# Modern Todo MCP Server with Authentication, Database & Billing

A complete **Model Context Protocol (MCP)** server that demonstrates modern web development practices with authentication, billing, and database integration. Perfect for beginners learning full-stack development!

## What This Project Does

This project creates a **Todo Management System** that you can interact with through **Cursor AI** (or any MCP-compatible client). It includes:

- **Real Authentication** with Kinde
- **Billing System** with free tier limits
- **Database Storage** with Neon PostgreSQL
- **AI Integration** through MCP protocol
- **Web Interface** for authentication

## Key Features

- **5 Free Todos** for new users
- **Upgrade to Paid** for unlimited todos
- **Real Authentication** with Google/social login
- **Database Persistence** with PostgreSQL
- **AI Chat Integration** through Cursor
- **Session Management** with secure cookies

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cursor AI     │    │   MCP Server     │    │  Kinde Auth     │
│   (Your Chat)   │◄──►│   (This Project) │◄──►│   (Authentication)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Neon Database   │
                       │  (PostgreSQL)    │
                       └──────────────────┘
```

## Prerequisites

Before you start, you'll need:

1. **Node.js** (version 18 or higher)
2. **A Neon Database** account (free)
3. **A Kinde account** (free)
4. **Cursor IDE** (for MCP integration)

## Quick Start Guide

### Step 1: Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd mcp-todo-rebuild

# Install dependencies
npm install
```

### Step 2: Set Up Environment

```bash
# Run the setup script
chmod +x setup.sh
./setup.sh
```

This creates a `.env` file with placeholder values.

### Step 3: Set Up Neon Database (Free)

1. Go to [neon.tech](https://neon.tech)
2. Create a free account
3. Create a new database
4. Copy your connection string
5. Update your `.env` file:

```env
DATABASE_URL=postgresql://your-connection-string-here
```

### Step 4: Set Up Kinde Authentication (Free)

1. Go to [kinde.com](https://kinde.com)
2. Create a free account
3. Create a new application
4. Copy your credentials
5. Update your `.env` file:

```env
KINDE_ISSUER_URL=https://your-domain.kinde.com
KINDE_CLIENT_ID=your_client_id
KINDE_CLIENT_SECRET=your_client_secret
```

### Step 5: Initialize Database

```bash
# Set up database tables
npm run setup-db
```

### Step 6: Build and Run

```bash
# Build the project
npm run build

# Start the MCP server
npm start
```

## Project Structure

```
mcp-todo-rebuild/
├── src/
│   ├── server.ts              # Main MCP server
│   ├── kinde-auth-server.ts   # Authentication web server
│   └── setup-db.ts           # Database setup script
├── dist/                     # Compiled JavaScript
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── .env                     # Environment variables (create this)
└── README.md               # This file
```

## How It Works

### 1. **MCP Server** (`src/server.ts`)
- Handles AI chat commands like "create todo", "list todos"
- Manages user authentication and billing
- Connects to database for data persistence

### 2. **Auth Server** (`src/kinde-auth-server.ts`)
- Provides web interface for login/logout
- Handles OAuth flow with Kinde
- Automatically creates user database records

### 3. **Database Setup** (`src/setup-db.ts`)
- Creates necessary database tables
- Sets up indexes for performance
- Initializes user and todo schemas

## How to Use

### 1. Start the Servers

```bash
# Terminal 1: Start MCP server
npm start

# Terminal 2: Start auth server
npm run auth-server
```

### 2. Configure Cursor

Add this to your Cursor MCP configuration (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "todo-mcp-server": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/your/project",
      "env": {
        "DATABASE_URL": "your_database_url",
        "KINDE_ISSUER_URL": "your_kinde_issuer",
        "KINDE_CLIENT_ID": "your_client_id",
        "KINDE_CLIENT_SECRET": "your_client_secret",
        "JWT_SECRET": "your_jwt_secret",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### 3. Use in Cursor Chat

Once configured, you can use these commands in Cursor:

```
login                    # Get authentication URL
save_token: <token>     # Save your login token
list todos              # View your todos
create todo             # Create a new todo
update todo             # Update an existing todo
delete todo             # Delete a todo
logout                  # Log out
```

## Authentication Flow

1. **Type "login"** in Cursor chat
2. **Click the URL** to open authentication page
3. **Login with Google** (or other providers)
4. **Copy your token** from the success page
5. **Use "save_token"** command in Cursor
6. **Start creating todos!**

## Billing System

- **Free Tier**: 5 todos per user
- **Paid Tier**: Unlimited todos (upgrade through Kinde portal)
- **Automatic Tracking**: System tracks usage automatically
- **Upgrade URL**: Provided when limit is reached

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  subscription_status TEXT DEFAULT 'free',
  plan TEXT DEFAULT 'free',
  free_todos_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Todos Table
```sql
CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Development Commands

```bash
# Development
npm run dev              # Run MCP server in development
npm run auth-server     # Run auth server in development

# Database
npm run setup-db        # Set up database tables

# Production
npm run build           # Build for production
npm start              # Run production server
```

## Configuration

### Environment Variables

Create a `.env` file with these variables:

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# Kinde Authentication
KINDE_ISSUER_URL=https://your-domain.kinde.com
KINDE_CLIENT_ID=your_client_id
KINDE_CLIENT_SECRET=your_client_secret

# Security
JWT_SECRET=your_secret_key

# Environment
NODE_ENV=development
```

## Troubleshooting

### Common Issues

1. **"No authentication token found"**
   - Make sure you've logged in and saved your token
   - Check that the auth server is running

2. **"Database connection failed"**
   - Verify your DATABASE_URL is correct
   - Make sure you've run `npm run setup-db`

3. **"Kinde authentication failed"**
   - Check your Kinde credentials in `.env`
   - Verify your redirect URLs in Kinde dashboard

4. **"MCP server not found in Cursor"**
   - Restart Cursor after updating `mcp.json`
   - Check that the server is running with `npm start`

### Debug Mode

Run with debug logging:

```bash
DEBUG=* npm run dev
```

## Learning Resources

### What You'll Learn

- **MCP Protocol**: How AI assistants interact with tools
- **OAuth 2.0**: Modern authentication flows
- **PostgreSQL**: Database design and queries
- **TypeScript**: Type-safe JavaScript development
- **Express.js**: Web server development
- **Session Management**: User state persistence

### Key Concepts

1. **Model Context Protocol (MCP)**: Standard for AI tool integration
2. **OAuth Flow**: Secure authentication without passwords
3. **JWT Tokens**: Secure user identification
4. **Database Relations**: User-todo relationships
5. **Billing Integration**: Freemium business models

## Next Steps

Once you understand this project, you can:

1. **Add More Features**: Categories, due dates, sharing
2. **Improve UI**: Better web interface for auth
3. **Add Real Billing**: Stripe integration
4. **Deploy**: Host on Vercel, Railway, or AWS
5. **Scale**: Add caching, load balancing

## Contributing

This is a learning project! Feel free to:

- Report bugs
- Suggest improvements
- Add new features
- Create tutorials

## License

MIT License - feel free to use this for learning and projects!

## Need Help?

If you get stuck:

1. Check the troubleshooting section above
2. Verify all environment variables are set
3. Make sure all services are running
4. Check the console for error messages

Remember: This is a learning project designed to teach modern web development concepts. Take your time, experiment, and don't hesitate to explore the code!