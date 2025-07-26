import { RateLimiter } from "./rate-limiter";
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

export { RateLimiter, Sandbox };

interface ExecuteRequest {
  code: string;
  language: "javascript" | "python" | "c" | "cpp" | "rust" | "java";
  testCases: Array<{
    stdin: string;
    timeLimit: number;
    memoryLimit: number;
  }>;
}

interface ExecutionResult {
  testCaseIndex: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  maxMemoryUsed: number;
  executionTime: number;
  timedOut: boolean;
  memoryExceeded: boolean;
  error?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Secret-Token",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Validate origin
    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      "http://localhost:5173",
      "https://yourdomain.com", // for production
    ];

    if (!allowedOrigins.includes(origin || "")) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Validate secret token
    const secretToken = request.headers.get("X-Secret-Token");
    if (secretToken !== env.SECRET_TOKEN) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Handle code execution
    if (url.pathname === "/api/execute" && request.method === "POST") {
      return this.handleCodeExecution(request, env, corsHeaders);
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },

  async handleCodeExecution(
    request: Request,
    env: Env,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    try {
      // Check rate limit
      const rateLimitResponse = await this.checkRateLimit(request, env);
      if (rateLimitResponse.status !== 200) {
        return new Response(rateLimitResponse.body, {
          status: rateLimitResponse.status,
          headers: {
            ...corsHeaders,
            ...Object.fromEntries(rateLimitResponse.headers),
          },
        });
      }

      // Parse request
      const body: ExecuteRequest = await request.json();

      // Validate request
      if (!body.code || !body.language || !body.testCases) {
        return new Response("Invalid request", {
          status: 400,
          headers: corsHeaders,
        });
      }

      // For now, only support JavaScript
      if (body.language !== "javascript") {
        return new Response("Only JavaScript is supported for now", {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Execute code for each test case in parallel
      const executionPromises = body.testCases.map(async (testCase, index) => {
        const result = await this.executeJavaScript(body.code, testCase, env);
        return {
          testCaseIndex: index,
          ...result,
        };
      });

      const results = await Promise.all(executionPromises);

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      console.error("Error handling code execution:", error);
      return new Response("Internal server error", {
        status: 500,
        headers: corsHeaders,
      });
    }
  },

  async checkRateLimit(request: Request, env: Env): Promise<Response> {
    const clientIP =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";

    // Create a deterministic ID for the IP
    const rateLimiterId = env.RATE_LIMITER.idFromName(clientIP);
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    return rateLimiter.fetch(new Request("http://dummy/check"));
  },

  async executeJavaScript(
    code: string,
    testCase: { stdin: string; timeLimit: number; memoryLimit: number },
    env: Env
  ): Promise<Omit<ExecutionResult, "testCaseIndex">> {
    const startTime = Date.now();

    try {
      // Create a unique sandbox ID for this execution
      const sandboxId = `js-exec-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const sandbox = getSandbox(env.Sandbox, sandboxId);

      // Create a JavaScript file with the code and monitoring
      const jsCode = `
// Capture console.log output
const originalLog = console.log;
const outputs = [];

console.log = (...args) => {
  outputs.push(args.join(' '));
  originalLog(...args);
};

// Make stdin available
const stdin = "${testCase.stdin.replace(/"/g, '\\"')}";

// Execute user code
${code}

// Output results
console.log("===OUTPUT===");
outputs.forEach(output => console.log(output));
console.log("===STDIN===");
console.log(stdin);
`;

      // Write the code to a file
      await sandbox.writeFile("/app/code.js", jsCode);

      // Execute with Node.js
      const result = await sandbox.exec("node /app/code.js");

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Handle the result - assume it has the expected structure
      const execResult = result as any;

      // Extract the actual program output
      const outputLines = (execResult.stdout || "").split("\n");
      const outputStart = outputLines.findIndex((line: string) =>
        line.includes("===OUTPUT===")
      );
      const outputEnd = outputLines.findIndex((line: string) =>
        line.includes("===STDIN===")
      );

      let stdout = "";
      if (outputStart !== -1 && outputEnd !== -1) {
        stdout = outputLines.slice(outputStart + 1, outputEnd).join("\n");
      }

      return {
        stdout: stdout.trim(),
        stderr: execResult.stderr || "",
        exitCode: execResult.exitCode || 0,
        maxMemoryUsed: 0, // TODO: Implement memory monitoring
        executionTime,
        timedOut: executionTime >= testCase.timeLimit,
        memoryExceeded: false, // TODO: Implement memory monitoring
      };
    } catch (error) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown error",
        exitCode: 1,
        maxMemoryUsed: 0,
        executionTime,
        timedOut: error instanceof Error && error.message.includes("timeout"),
        memoryExceeded: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
