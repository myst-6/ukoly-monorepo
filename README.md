# Programming Problems Platform

A programming problems platform built with the Cloudflare ecosystem, featuring sandboxed code execution and problem management.

## Project Status

**Current Phase**: Core code execution platform development
**Next Priority**: Implement sandboxed code execution with memory/time monitoring
**Blocked On**: None - ready to start implementation

## System Overview

### Core Features
- **Problem Catalog**: Programming problems with test cases (TBD - focus on execution first)
- **Code Execution**: Sandboxed execution for JS, Python, C, C++, Rust, Java
- **Two Views**: User view (solve problems) and Trusted view (manage problems)
- **Rate Limiting**: IP-based rate limiting for code execution
- **Authentication**: JWT-based system for user management

### Implementation Priority
1. **Code Execution Engine** (Current Focus)
2. **Rate Limiting System**
3. **Authentication System**
4. **Frontend Interface**
5. **Problem Management** (TBD)
6. **Submission Tracking** (TBD)

## Architecture

### Frontend
- **React + Vite**: Modern React app with minimal boilerplate
- **shadcn/ui**: Component library for consistent UI
- **Monaco Editor**: Code editor with syntax highlighting
- **React Router**: Separate pages for different views
- **Local Development**: Runs on localhost:5173

### Backend (Cloudflare Workers)
- **API Worker**: Main API endpoints for code execution and problem management
- **Auth Worker**: JWT-based authentication system
- **Rate Limiter**: Durable Object per IP for rate limiting
- **Local Development**: All workers run locally with `wrangler dev`

### Data Storage
- **D1 Database**: Problems, test cases, user accounts, submissions (TBD)
- **Durable Objects**: Code execution sandboxes with resource limits
- **KV Store**: Admin access control

## Code Execution System

### Sandbox Architecture
- **Custom Dockerfile**: Pre-installed compilation tools and monitoring
- **Parallel Execution**: One sandbox per test case for maximum speed
- **Memory Monitoring**: Custom script with 5ms intervals via `/proc/[pid]/status`
- **Time Limits**: Maximum 5 seconds per test case
- **Memory Limits**: Configurable per test case
- **Early Termination**: Kills processes that exceed limits
- **Container Limits**: Maximum 25 concurrent containers (Cloudflare Workers limitation)

### Performance Optimization Opportunities
- **Execution Pooling**: Consider grouping test cases into batches of 5 per container to reduce container usage and avoid hitting the 25 concurrent container limit
- **Container Reuse**: Pool containers for sequential execution when parallel execution isn't critical
- **Smart Batching**: Balance between execution speed (parallel) and resource limits (pooled)

### Implementation Details

#### Custom Dockerfile Requirements
```dockerfile
# Base image with all required tools
FROM ubuntu:22.04

# Install compilation tools and runtimes
RUN apt-get update && apt-get install -y \
    gcc g++ rustc cargo openjdk-17-jdk python3 python3-pip nodejs npm \
    time procps bc

# Create monitoring script at /usr/local/bin/monitor.sh
# Script should monitor memory usage every 5ms and terminate on limits
# Return JSON with exit_code, max_memory_kb, execution_time_ms

# Create non-root user for security
RUN useradd -m -s /bin/bash coder
USER coder
WORKDIR /workspace
```

#### Memory Monitoring Script Requirements
- **Input**: time_limit_ms, memory_limit_kb, command
- **Monitoring**: Check /proc/[pid]/status every 5ms
- **Termination**: Kill process if limits exceeded
- **Output**: JSON with execution metrics
- **Error Handling**: Handle process termination gracefully

#### Language Support Implementation
```typescript
// Supported languages and their execution commands
const LANGUAGE_CONFIG = {
  javascript: { command: 'node -e', extension: '.js' },
  python: { command: 'python3 -c', extension: '.py' },
  c: { compile: 'gcc -o', run: './', extension: '.c' },
  cpp: { compile: 'g++ -o', run: './', extension: '.cpp' },
  rust: { compile: 'rustc -o', run: './', extension: '.rs' },
  java: { compile: 'javac', run: 'java -cp .', extension: '.java' }
};
```

### Supported Languages
- **JavaScript**: Node.js runtime
- **Python**: Python 3 runtime
- **C**: GCC compiler
- **C++**: G++ compiler
- **Rust**: Rustc compiler
- **Java**: OpenJDK 17

### Execution Flow
1. User submits code + language + test cases
2. API validates origin and secret token
3. Rate limiter checks IP limits (5 batches/minute)
4. For compiled languages: compile once per sandbox
5. Execute each test case in parallel sandbox
6. Monitor memory/time usage with custom script
7. Return results with execution metrics

### API Endpoint Specification
```typescript
// POST /api/execute
interface ExecuteRequest {
  code: string;
  language: 'javascript' | 'python' | 'c' | 'cpp' | 'rust' | 'java';
  testCases: Array<{
    stdin: string;
    timeLimit: number; // milliseconds
    memoryLimit: number; // bytes
  }>;
}

interface ExecuteResponse {
  results: Array<{
    testCaseIndex: number;
    stdout: string;
    stderr: string;
    exitCode: number;
    maxMemoryUsed: number; // bytes
    executionTime: number; // milliseconds
    timedOut: boolean;
    memoryExceeded: boolean;
    error?: string;
  }>;
}
```

## Rate Limiting

### Implementation
- **Durable Object per IP**: Atomic state management
- **5 batches per minute per IP**: Configurable limits
- **429 Response**: Standard HTTP rate limit response with Retry-After header
- **No differentiation**: Same limits for anonymous and authenticated users

### Storage
- **Durable Object State**: Request timestamps with automatic cleanup
- **1-minute sliding window**: Old requests automatically expire
- **Extensible**: Easy to add monitoring and admin bypass later

### Implementation Requirements
```typescript
// Rate Limiter Durable Object
export class RateLimiter {
  // Store request timestamps in Durable Object state
  // Check rate limit: 5 batches per minute per IP
  // Return 429 with Retry-After header when limit exceeded
  // Clean up old timestamps automatically
}

// API Worker Integration
// - Extract client IP from CF-Connecting-IP or X-Forwarded-For
// - Create deterministic Durable Object ID from IP
// - Check rate limit before processing execution request
```

## Authentication System

### User Management
- **D1 Database**: Users table with userId, username, salt, password_hash
- **Username Validation**: `[a-zA-Z_\-0-9]{3,32}` regex
- **Password Security**: SHA-256 with salt (Cloudflare Workers compatible)
- **JWT Tokens**: 30-day validity, no refresh tokens
- **Multiple Sessions**: Users can have multiple active sessions

### Admin System
- **KV Store**: Simple admin lookup by user ID
- **Manual Setup**: Admins set via Cloudflare dashboard only
- **Extensible**: Easy to add role-based permissions later

### Auth Worker
- **Single Worker**: Handles registration, login, and token verification
- **Endpoints**: `/register`, `/login`, `/verify`
- **CORS Support**: Cross-origin requests for frontend integration

### Implementation Requirements
```typescript
// Database Schema
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

// Auth Worker Endpoints
// POST /register - Create new user account
// POST /login - Authenticate and return JWT
// POST /verify - Validate JWT token

// Password Hashing: SHA-256 with salt (Cloudflare Workers compatible)
// JWT: 30-day validity, no refresh tokens
// Username Validation: [a-zA-Z_\-0-9]{3,32}
```

## Security & Access Control

### API Protection
- **CORS Validation**: Origin checking for frontend requests
- **Secret Token**: Required header for API access
- **IP Rate Limiting**: Prevents abuse from external scripts

### Implementation Requirements
```typescript
// CORS Validation
const allowedOrigins = [
  'https://yourdomain.com',
  'http://localhost:5173' // development
];

// Secret Token Validation
const secretToken = request.headers.get('X-Secret-Token');
if (secretToken !== env.SECRET_TOKEN) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Sandbox Security
- **Isolated Execution**: Each test case runs in separate sandbox
- **Resource Limits**: Time and memory limits enforced
- **No Network Access**: Sandboxes cannot make external requests
- **Non-root User**: Security through minimal privileges

## Data Models (TBD - Future Implementation)

### Problems
- **PDF Links**: Problems stored as external PDF links
- **Metadata**: Title, difficulty, tags, etc. (structure TBD)
- **Test Cases**: Input/output, limits, checkers (structure TBD)

### Submissions
- **User Tracking**: Link submissions to authenticated users
- **Results Storage**: Execution results and metrics
- **History**: Submission history per user per problem

### API Endpoints (TBD - Future Implementation)
- **Problem Management**: CRUD operations for problems
- **Code Execution**: Submit and execute code
- **Results**: Get execution results and history
- **User Management**: Registration, login, profile

### Current Focus
- **Code Execution API**: POST /api/execute (implement first)
- **Rate Limiting**: Durable Object per IP
- **Authentication**: Basic JWT system
- **Frontend**: Code editor with execution interface

## Implementation Guide

### Current Development State
- **Package.json**: Root workspace configured with pnpm workspaces
- **API Worker**: wrangler.toml created, ready for implementation
- **Frontend**: Not yet created
- **Auth Worker**: Not yet created
- **Rate Limiter**: Not yet created

### Next Implementation Steps

#### 1. Create Frontend (React + Vite)
```bash
# Create frontend directory structure
mkdir -p frontend/src/components frontend/src/pages frontend/src/lib
cd frontend

# Initialize with Vite + React + TypeScript
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install @monaco-editor/react lucide-react class-variance-authority clsx tailwind-merge
npm install react-markdown rehype-highlight rehype-raw remark-gfm
npm install axios react-hot-toast react-router-dom
npm install -D tailwindcss postcss autoprefixer
```

#### 2. Create API Worker Implementation
```bash
# Create API worker structure
mkdir -p workers/api-worker/src
cd workers/api-worker

# Install dependencies
npm init -y
npm install -D wrangler typescript @cloudflare/workers-types
```

#### 3. Create Auth Worker Implementation
```bash
# Create auth worker structure
mkdir -p workers/auth-worker/src
cd workers/auth-worker

# Install dependencies
npm init -y
npm install -D wrangler typescript @cloudflare/workers-types
```

#### 4. Create Rate Limiter Durable Object
```bash
# Create rate limiter structure
mkdir -p workers/rate-limiter/src
cd workers/rate-limiter

# Install dependencies
npm init -y
npm install -D wrangler typescript @cloudflare/workers-types
```

### Local Development Setup
```bash
# Install dependencies
pnpm install

# Start frontend
pnpm --filter frontend dev

# Start API worker
pnpm --filter api-worker dev

# Start auth worker
pnpm --filter auth-worker dev
```

### Development URLs
- **Frontend**: http://localhost:5173
- **API Worker**: http://localhost:8787
- **Auth Worker**: http://localhost:8788

### Local Services
- **D1 Database**: Local SQLite for development
- **Durable Objects**: Local development mode
- **KV Store**: Local storage for development

## Deployment

### Production Setup
- **Frontend**: Deploy to Cloudflare Pages
- **Workers**: Deploy with `wrangler deploy`
- **Database**: Production D1 instance
- **Durable Objects**: Production environment

### Environment Variables
- **SECRET_TOKEN**: API access token
- **JWT_SECRET**: JWT signing secret
- **ENVIRONMENT**: Development/production flag

## Development Notes

### Key Decisions Made
1. **Parallel Execution**: One sandbox per test case for 20x speed improvement
2. **Memory Monitoring**: Custom script with 5ms intervals via /proc/[pid]/status
3. **Rate Limiting**: Durable Object per IP with 5 batches/minute limit
4. **Authentication**: Simple JWT system with 30-day tokens, no refresh
5. **Local Development**: All services run locally for testing
6. **Security**: CORS + secret token + IP rate limiting

### Technical Constraints
- **Cloudflare Workers**: Limited to Web APIs (no Node.js crypto)
- **Sandbox SDK**: No built-in memory monitoring, need custom script
- **Durable Objects**: Perfect for rate limiting but no built-in cleanup
- **D1 Database**: SQL database with edge replication

### Future Enhancements (After Core Implementation)
- **Problem Management**: Full CRUD for problems and test cases
- **Submission History**: Track and display user submissions
- **Leaderboards**: Competition and ranking systems
- **Advanced Checkers**: Custom validation functions
- **Performance Analytics**: Execution time and memory usage tracking

### Extensibility Points
- **Additional Languages**: Easy to add new language support
- **Custom Sandboxes**: Configurable execution environments
- **Advanced Rate Limiting**: Per-user, per-problem limits
- **File Uploads**: Support for file-based problems

## Technical Decisions

### Why Cloudflare Ecosystem?
- **Global Edge Network**: Low latency worldwide
- **Durable Objects**: Perfect for rate limiting and stateful operations
- **Workers**: Serverless execution with minimal cold starts
- **D1**: SQL database with edge replication
- **Integrated Security**: Built-in DDoS protection and security

### Why Parallel Execution?
- **Speed**: 20x faster than sequential execution
- **Fault Isolation**: One hanging test doesn't affect others
- **Resource Efficiency**: Better CPU utilization
- **User Experience**: Faster feedback for users

### Why Custom Memory Monitoring?
- **Accuracy**: Real-time memory usage tracking
- **Control**: Custom limits and early termination
- **No External Dependencies**: Everything runs in-house
- **Extensibility**: Easy to add more monitoring features 