# Testing the Code Execution Platform

## Setup Instructions

### 1. Install All Dependencies (from root)
```bash
# Install all dependencies for the entire workspace
pnpm install:all
```

### 2. Start the Services

#### Option A: Start Both Services Together (Recommended)
```bash
# Start both frontend and API worker simultaneously
pnpm dev
```

#### Option B: Start Services Separately
```bash
# Start API worker only
pnpm dev:api

# Start frontend only (in another terminal)
pnpm dev:frontend
```

### 3. Test the Platform

1. Open http://localhost:5173 in your browser
2. You should see the code execution interface with:
   - Monaco code editor (JavaScript)
   - Test cases textarea
   - Execute button

3. Try this test code:
```javascript
console.log("Hello from the sandbox!");
console.log("Input:", process.stdin);
```

4. Add test cases:
```
Hello, World!
===
Test case 2
===
Another test case
```

5. Click "Execute Code" and check the JSON results

## Available Commands (from root)

```bash
# Development
pnpm dev                    # Start both frontend and API worker
pnpm dev:frontend          # Start frontend only
pnpm dev:api               # Start API worker only

# Building
pnpm build                 # Build both frontend and API worker
pnpm build:frontend        # Build frontend only
pnpm build:api             # Build API worker only

# Deployment
pnpm deploy                # Deploy API worker to Cloudflare

# Maintenance
pnpm install:all           # Install all dependencies
pnpm clean                 # Clean all node_modules
```

## Expected Behavior

- **Rate Limiting**: You can make 5 requests per minute per IP
- **CORS**: Only requests from localhost:5173 are allowed
- **Security**: Requires X-Secret-Token header
- **JavaScript Execution**: Basic console.log and process.stdin access
- **Timeout**: 5-second time limit per test case

## Troubleshooting

### Workspace Issues
- Run `pnpm install:all` to ensure all dependencies are installed
- Use `pnpm clean` to reset all node_modules if needed
- Check that pnpm-workspace.yaml is properly configured

### Frontend Issues
- Check if all dependencies are installed: `pnpm --filter frontend install`
- Ensure Vite is running on port 5173
- Check browser console for errors

### API Worker Issues
- Ensure Wrangler is installed globally: `npm install -g wrangler`
- Check if port 8787 is available
- Verify Durable Objects are working in local mode
- Check worker dependencies: `pnpm --filter api-worker install`

### CORS Issues
- Ensure the frontend is running on exactly http://localhost:5173
- Check that the API worker CORS headers are correct

## Project Structure

```
ukoly-monorepo/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml       # Workspace definition
├── frontend/                 # React frontend
│   ├── package.json
│   ├── src/
│   └── ...
├── workers/
│   └── api-worker/          # API worker
│       ├── package.json
│       ├── src/
│       └── wrangler.toml
└── README.md
```

## Next Steps

1. **Sandbox SDK Integration**: Replace the simple eval with Cloudflare Sandbox SDK
2. **Memory Monitoring**: Implement proper memory usage tracking
3. **Additional Languages**: Add support for Python, C, C++, Rust, Java
4. **Authentication**: Add user registration and login
5. **Problem Management**: Add problem creation and management interface 