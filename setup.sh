#!/bin/bash

echo "🚀 Setting up Modern Todo MCP Server..."
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Neon PostgreSQL Database (replace with your actual connection string)
DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/neondb

# Kinde Authentication (replace with your actual credentials)
KINDE_ISSUER_URL=https://your-domain.kinde.com
KINDE_CLIENT_ID=your_kinde_client_id
KINDE_CLIENT_SECRET=your_kinde_client_secret

# JWT Configuration
JWT_SECRET=your_jwt_secret_key

# Server Configuration
NODE_ENV=development
EOF
    echo "✅ .env file created!"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "📋 Next steps:"
echo "1. Set up Neon PostgreSQL database:"
echo "   - Go to https://neon.tech"
echo "   - Create a free account and database"
echo "   - Copy your connection string to .env"
echo ""
echo "2. Set up Kinde authentication:"
echo "   - Go to https://kinde.com"
echo "   - Create an account and application"
echo "   - Copy your credentials to .env"
echo ""
echo "3. Set up the database:"
echo "   npm run setup-db"
echo ""
echo "4. Build and run:"
echo "   npm run build"
echo "   npm start"
echo ""
echo "🎉 Your modern MCP server is ready!"
