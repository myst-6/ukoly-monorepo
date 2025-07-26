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
		corsHeaders: Record<string, string>,
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
		env: Env,
	): Promise<Omit<ExecutionResult, "testCaseIndex">> {
		// Create a unique sandbox ID for this execution
		const sandboxId = `js-exec-${Date.now()}-${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		const sandbox = getSandbox(env.Sandbox, sandboxId);

		try {
			await sandbox.exec("echo 'Hello, world!'"); // allow container to start before doing file I/O

			// Base64 encode the stdin to avoid escaping issues
			const encodedStdin = btoa(testCase.stdin);

			// Create a JavaScript file with the code
			const jsCode = `
// Setup input handling
const input = (lines => () => lines.pop() || "")(atob("${encodedStdin}").split("\\n").map(line => line.trim()).reverse());

// Execute user code
${code}
`;

			// Write the code to a file
			await sandbox.writeFile("/app/code.js", jsCode);

			// Execute with monitoring script for immediate limit enforcement
			const monitorCommand = `/usr/local/bin/monitor.sh ${testCase.timeLimit} ${testCase.memoryLimit} "node /app/code.js"`;
			console.log('running on sandbox', sandboxId);
			const result = await sandbox.exec(monitorCommand);
			console.log('finished running on sandbox', sandboxId);

			// Parse monitoring results
			let monitorData: {
				exit_code: number;
				max_memory_kb: number;
				execution_time_ms: number;
				time_exceeded: boolean;
				memory_exceeded: boolean;
			};
			try {
				// The monitor script outputs JSON on the last line
				const lines = (result.stdout || "").trim().split("\n");
				let lastLine = lines[lines.length - 1];
				
				// Handle potential trailing EOF issue
				if (lastLine.trim() === "EOF") {
					lastLine = lines[lines.length - 2];
				}
				
				monitorData = JSON.parse(lastLine);
				
				// Remove the JSON line(s) from stdout to get clean program output
				let cleanLines = lines.slice(0, -1);
				if (lines[lines.length - 1].trim() === "EOF") {
					cleanLines = lines.slice(0, -2);
				}
				const programOutput = cleanLines.join("\n");
				
				return {
					stdout: programOutput,
					stderr: result.stderr || "",
					exitCode: monitorData.exit_code || 0,
					maxMemoryUsed: monitorData.max_memory_kb || 0,
					executionTime: monitorData.execution_time_ms || 0,
					timedOut: monitorData.time_exceeded || false,
					memoryExceeded: monitorData.memory_exceeded || false,
				};
			} catch (parseError) {
				console.error('JSON parsing error:', parseError);
				// Fallback if JSON parsing fails
				return {
					stdout: result.stdout || "",
					stderr: result.stderr || "",
					exitCode: result.exitCode || 1,
					maxMemoryUsed: 0,
					executionTime: 0,
					timedOut: false,
					memoryExceeded: false,
				};
			}
		} catch (error) {
			console.error('Sandbox execution error:', error);
			return {
				stdout: "",
				stderr: error instanceof Error ? error.message : "Unknown error",
				exitCode: 1,
				maxMemoryUsed: 0,
				executionTime: 0,
				timedOut: error instanceof Error && error.message.includes("timeout"),
				memoryExceeded: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		} finally {
			// ALWAYS destroy the sandbox container to prevent resource leaks
			try {
				console.log('destroying sandbox', sandboxId);
				await sandbox.destroy();
				console.log('destroyed sandbox', sandboxId);
			} catch (destroyError) {
				console.error('Error destroying sandbox:', sandboxId, destroyError);
				// Don't throw here - we want to return the original result even if cleanup fails
			}
		}
	},
};
