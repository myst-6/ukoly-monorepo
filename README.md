# Ukoly Monorepo

Programming problems platform built with the Cloudflare ecosystem.

## Overview

This monorepo contains:
- **Frontend**: React + TypeScript application built with Vite
- **API Worker**: Cloudflare Worker for code execution with sandboxing

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v10 or higher)
- [Docker](https://www.docker.com/) (for code execution sandbox)

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Run the development environment:**
   ```bash
   pnpm dev
   ```

   This will start both the frontend and API worker in development mode.

## Development Setup

### Docker Setup for macOS (Apple Silicon)

If you're running on a MacBook with Apple Silicon, you'll need to modify the Dockerfile for the sandbox environment:

In `workers/api-worker/sandbox.Dockerfile`, uncomment the platform-specific line:
```dockerfile
# Change this line:
FROM docker.io/cloudflare/sandbox:0.1.3

# To this:
FROM --platform=linux/arm64 docker.io/cloudflare/sandbox:0.1.3
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start both frontend and API worker in development mode |
| `pnpm dev:frontend` | Start only the frontend development server |
| `pnpm dev:api` | Start only the API worker in development mode |
| `pnpm build` | Build both frontend and API worker for production |
| `pnpm deploy` | Deploy both applications |
| `pnpm lint` | Run Biome linter across the entire monorepo |
| `pnpm lint:fix` | Run Biome linter with auto-fix and unsafe fixes |
| `pnpm format` | Format code using Biome |

### Code Quality

This project uses [Biome](https://biomejs.dev/) for linting and formatting:

- **Lint**: `pnpm run lint`
- **Auto-fix**: `pnpm run lint:fix`
- **Format**: `pnpm run format`

## Project Structure

```
ukoly-monorepo/
├── frontend/          # React frontend application
│   ├── src/
│   ├── public/
│   └── package.json
├── workers/
│   └── api-worker/    # Cloudflare Worker for code execution
│       ├── src/
│       └── package.json
├── package.json       # Root package.json with workspace configuration
└── biome.json        # Biome configuration for linting and formatting
```

## Tech Stack

### Frontend
- React 19
- TypeScript
- Vite
- Tailwind CSS
- Monaco Editor (for code editing)

### Backend
- Cloudflare Workers
- TypeScript
- Cloudflare Sandbox (for secure code execution)

## Contributing

1. Make sure to run `pnpm lint` before committing
2. Use `pnpm lint:fix` to automatically fix formatting issues
3. Follow the existing code style and conventions 