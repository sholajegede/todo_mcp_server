import express from 'express';
import session from 'express-session';
import { createKindeServerClient, GrantType, SessionManager } from '@kinde-oss/kinde-typescript-sdk';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

const app = express();
const PORT = 3000;

// Database connection
const sql = neon(process.env.DATABASE_URL!);

// Extend session interface
declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    idToken?: string;
    userInfo?: any;
    userName?: string;
    userEmail?: string;
  }
}

// Add session middleware
app.use(session({
  secret: process.env.JWT_SECRET || 'your_jwt_secret_key',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true, // More secure
    sameSite: 'lax' // Better for localhost
  }
}));

// Session manager factory
const createSessionManager = (req: any): SessionManager => ({
  getSessionItem: async (key: string) => req.session?.[key],
  setSessionItem: async (key: string, value: any) => {
    if (!req.session) req.session = {};
    req.session[key] = value;
  },
  removeSessionItem: async (key: string) => {
    if (req.session) delete req.session[key];
  },
  destroySession: async () => {
    req.session = {};
  }
});

// Create Kinde client
const kindeClient = createKindeServerClient(GrantType.AUTHORIZATION_CODE, {
  authDomain: process.env.KINDE_ISSUER_URL!,
  clientId: process.env.KINDE_CLIENT_ID!,
  clientSecret: process.env.KINDE_CLIENT_SECRET!,
  redirectURL: 'http://localhost:3000/callback',
  logoutRedirectURL: 'http://localhost:3000',
});

// Home page with login button
app.get('/', (req, res) => {
  const token = req.session?.accessToken;
  const userInfo = req.session?.userInfo;
  
  if (token) {
    // Use stored user info from session
    const userEmail = req.session?.userEmail || 'user@example.com';
    const userName = req.session?.userName || 'User';
    console.log('👤 Displaying user:', { userName, userEmail });
    
    res.send(`
      <html>
        <head>
          <title>Kinde Auth Test</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 600px; margin: 0 auto; }
            .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .token-box { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .btn { display: inline-block; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px; }
            .btn-primary { background: #007bff; color: white; }
            .btn-success { background: #28a745; color: white; }
            .btn-danger { background: #dc3545; color: white; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎉 Already Authenticated!</h1>
            <div class="success">
              <strong>Welcome back, ${userName}!</strong><br>
              Email: ${userEmail}<br>
              Session persists across page refreshes.
            </div>
            
            <h2>🔑 Your Access Token:</h2>
            <div class="token-box">
              <textarea id="accessToken" style="width: 100%; height: 100px; font-family: monospace; border: none; background: transparent;" readonly>${token}</textarea>
              <button onclick="copyAccessToken()" style="margin-top: 10px; padding: 5px 10px;">Copy Access Token</button>
            </div>
            
            <h2>🆔 Your ID Token (Use this with MCP server):</h2>
            <div class="token-box">
              <textarea id="idToken" style="width: 100%; height: 100px; font-family: monospace; border: none; background: transparent;" readonly>${req.session.idToken || 'No ID token available'}</textarea>
              <button onclick="copyIdToken()" style="margin-top: 10px; padding: 5px 10px;">Copy ID Token</button>
            </div>
            
            <h2>💳 Billing Management:</h2>
            <p><a href="https://learnflowai.kinde.com/portal" target="_blank" class="btn btn-success">🔗 Manage Billing</a></p>
            
            <p>
              <a href="/logout" class="btn btn-danger">Logout</a>
              <a href="/" class="btn btn-primary">Refresh Page</a>
            </p>
          </div>
          
          <script>
            function copyAccessToken() {
              document.getElementById('accessToken').select();
              document.execCommand('copy');
              alert('Access Token copied to clipboard!');
            }
            
            function copyIdToken() {
              document.getElementById('idToken').select();
              document.execCommand('copy');
              alert('ID Token copied to clipboard! Use this with the MCP server.');
            }
          </script>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head>
          <title>Kinde Auth Test</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { display: inline-block; padding: 10px 20px; text-decoration: none; border-radius: 5px; background: #007bff; color: white; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Kinde Authentication Test</h1>
            <p>Click the button below to login with Kinde:</p>
            <a href="/login" class="btn">Login with Kinde</a>
          </div>
        </body>
      </html>
    `);
  }
});

// Login route
app.get('/login', async (req, res) => {
  try {
    const sessionManager = createSessionManager(req);
    const loginUrl = await kindeClient.login(sessionManager);
    res.redirect(loginUrl.toString());
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send('Login failed');
  }
});

// Callback route
app.get('/callback', async (req, res) => {
  try {
    const sessionManager = createSessionManager(req);
    const fullUrl = `http://${req.headers.host}${req.url}`;
    console.log('Callback URL:', fullUrl);
    
    // Extract the authorization code from the URL
    const url = new URL(fullUrl);
    const code = url.searchParams.get('code');
    
    if (!code) {
      return res.status(400).send('No authorization code received');
    }
    
    // Manually exchange the code for tokens
    const tokenResponse = await fetch(`${process.env.KINDE_ISSUER_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KINDE_CLIENT_ID!,
        client_secret: process.env.KINDE_CLIENT_SECRET!,
        code: code,
        redirect_uri: 'http://localhost:3000/callback',
      }),
    });
    
    const tokenData = await tokenResponse.json();
    console.log('Token response:', tokenData);
    
    if (tokenData.access_token) {
      // Store tokens in session for persistence
      req.session.accessToken = tokenData.access_token;
      req.session.idToken = tokenData.id_token;
      req.session.userInfo = tokenData;
      
      // Decode the ID token to get user info
      const idToken = tokenData.id_token;
      const user = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
      console.log('👤 User info from ID token:', user);
      
      // Store user info in session for easy access
      req.session.userName = user.given_name || user.name || 'User';
      req.session.userEmail = user.email || 'user@example.com';
      
      // Automatically create user in database
      try {
        const userId = user.sub;
        const userName = user.given_name || user.name || 'User';
        const userEmail = user.email || 'user@example.com';
        
        // Check if user already exists
        const existingUser = await sql`
          SELECT * FROM users WHERE user_id = ${userId}
        `;
        
        if (existingUser.length === 0) {
          // Create new user
          await sql`
            INSERT INTO users (user_id, name, email, subscription_status, plan, free_todos_used)
            VALUES (${userId}, ${userName}, ${userEmail}, 'free', 'free', 0)
          `;
          console.log('✅ User automatically created in database:', userName, userEmail);
        } else {
          // Update existing user info
          await sql`
            UPDATE users 
            SET name = ${userName}, email = ${userEmail}
            WHERE user_id = ${userId}
          `;
          console.log('✅ User info updated in database:', userName, userEmail);
        }
      } catch (error) {
        console.log('⚠️ Could not auto-create user in database:', error);
      }
      
      // Redirect to home page after successful authentication
      res.redirect('/');
    } else {
      console.log('No access token received');
      res.status(400).send('Authentication failed - no access token received');
    }
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Logout route
app.get('/logout', async (req, res) => {
  try {
    // Clear the session
    req.session.destroy((err) => {
      if (err) {
        console.log('Session destroy error:', err);
      }
      // Redirect to home page after logout
      res.redirect('/');
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).send('Logout failed');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kinde Auth Server running at http://localhost:${PORT}`);
  console.log('📋 Open your browser and go to http://localhost:3000');
  console.log('🔐 Login with your Kinde account to get a real JWT token');
});
