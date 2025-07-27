import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { RateLimiter } from "./rate-limiter";

// Sandbox for executing code
// Handles multiple test cases sequentially, sleeps after 20s
class ExecutionSandbox extends Sandbox {
	defaultPort = 3000;
	sleepAfter = "20s";
}

export { RateLimiter, ExecutionSandbox };

interface ExecuteRequest {
	code: string;
	language: "javascript" | "python" | "c" | "cpp" | "rust" | "java";
	testCases: Array<{
		stdin: string;
		timeLimitMs: number;
		memoryLimit: number;
	}>;
}

interface ExecutionResult {
	testCaseIndex: number;
	stdout: string;
	stderr: string;
	exitCode: number;
	memoryKB: number;
	timeMS: number;
	timedOut: boolean;
	memoryExceeded: boolean;
	error?: string;
}

interface WebSocketMessage {
	type: 'result' | 'error' | 'complete' | 'compilation_error';
	data?: ExecutionResult | string;
	totalTestCases?: number;
}

interface LanguageConfig {
	extension: string;
	isCompiled: boolean;
	compileCommand?: string;
	executeCommand: string;
	setupStdin?: (stdin: string) => string; // Function to setup stdin handling
}

const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
	javascript: {
		extension: ".js",
		isCompiled: false,
		executeCommand: "node /app/code.js",
		setupStdin: (stdin: string) => {
			// Base64 encode the stdin to avoid escaping issues
			const encodedStdin = btoa(stdin);
			return `
// Setup input handling
const input = (lines => () => lines.pop() || "")(atob("${encodedStdin}").split("\\n").map(line => line.trim()).reverse());

// Execute user code
`;
		},
	},
	cpp: {
		extension: ".cpp",
		isCompiled: true,
		compileCommand: "g++ -std=c++17 -O2 -o /app/executable /app/code.cpp",
		executeCommand: "/app/executable",
	},
	c: {
		extension: ".c",
		isCompiled: true,
		compileCommand: "gcc -std=c11 -O2 -o /app/executable /app/code.c",
		executeCommand: "/app/executable",
	},
	python: {
		extension: ".py",
		isCompiled: false,
		executeCommand: "python3 /app/code.py",
		setupStdin: (stdin: string) => {
			// Base64 encode the stdin to avoid escaping issues
			const encodedStdin = btoa(stdin);
			return `
import base64
import sys

# Setup input handling
_input_lines = base64.b64decode("${encodedStdin}").decode().strip().split("\\n")
_input_index = 0

def input():
    global _input_index
    if _input_index < len(_input_lines):
        line = _input_lines[_input_index]
        _input_index += 1
        return line
    return ""

# Execute user code
`;
		},
	},
	rust: {
		extension: ".rs",
		isCompiled: true,
		compileCommand: "rustc -O -o /app/executable /app/code.rs",
		executeCommand: "/app/executable",
	},
	java: {
		extension: ".java",
		isCompiled: true,
		compileCommand: "javac -d /app /app/Main.java",
		executeCommand: "java -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -cp /app Main",
	},
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// CORS headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS, GET",
			"Access-Control-Allow-Headers": "Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol",
		};

		// Handle preflight requests
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);

		const origin = request.headers.get("Origin");
		const allowedOrigins = [
			"http://localhost:5173",
			"https://ukoly-monorepo.mborishall.workers.dev", // for production
		];

		if (!allowedOrigins.includes(origin || "")) {
			return new Response("Forbidden", {
				status: 403,
				headers: corsHeaders,
			});
		}

		// Handle WebSocket upgrade for streaming execution
		if (url.pathname === "/api/execute-stream") {
			const upgradeHeader = request.headers.get("Upgrade");
			if (upgradeHeader !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);

			server.accept();
			this.handleWebSocketConnection(server, env);

			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		}

		// Handle code execution (keep for backward compatibility)
		if (url.pathname === "/api/execute" && request.method === "POST") {
			return this.handleCodeExecution(request, env, corsHeaders);
		}

		return new Response("Not found", {
			status: 404,
			headers: corsHeaders,
		});
	},

	async handleWebSocketConnection(webSocket: WebSocket, env: Env) {
		webSocket.addEventListener("message", async (event) => {
			try {
				const data = JSON.parse(event.data as string) as ExecuteRequest;
				
				// Check rate limit
				const clientIP = "websocket-user"; // WebSocket doesn't have IP easily accessible
				const rateLimiterId = env.RATE_LIMITER.idFromName(clientIP);
				const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);
				const rateLimitResponse = await rateLimiter.fetch(new Request("http://dummy/check"));
				
				if (rateLimitResponse.status !== 200) {
					webSocket.send(JSON.stringify({
						type: 'error',
						data: 'Rate limit exceeded'
					} as WebSocketMessage));
					return;
				}

				// Validate request
				if (!data.code || !data.language || !data.testCases) {
					webSocket.send(JSON.stringify({
						type: 'error',
						data: 'Invalid request'
					} as WebSocketMessage));
					return;
				}

				// Limit number of test cases
				if (data.testCases.length > 20) {
					webSocket.send(JSON.stringify({
						type: 'error',
						data: `Too many test cases. Maximum 20 allowed, got ${data.testCases.length}`
					} as WebSocketMessage));
					return;
				}

				// Get language configuration
				const languageConfig = LANGUAGE_CONFIG[data.language];
				if (!languageConfig) {
					webSocket.send(JSON.stringify({
						type: 'error',
						data: 'Language not supported'
					} as WebSocketMessage));
					return;
				}

				// Execute code with streaming
				await this.executeCodeStreaming(
					data.code,
					data.testCases,
					languageConfig,
					env,
					webSocket
				);

			} catch (error) {
				console.error("WebSocket message error:", error);
				webSocket.send(JSON.stringify({
					type: 'error',
					data: error instanceof Error ? error.message : 'Unknown error'
				} as WebSocketMessage));
			}
		});

		webSocket.addEventListener("close", () => {
			console.log("WebSocket connection closed");
		});

		webSocket.addEventListener("error", (error) => {
			console.error("WebSocket error:", error);
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

			// Limit number of test cases to prevent abuse
			if (body.testCases.length > 20) {
				return new Response(
					JSON.stringify({
						error: "Too many test cases",
						message: "Maximum 20 test cases allowed per request",
						provided: body.testCases.length,
						maximum: 20,
					}),
					{
						status: 400,
						headers: {
							...corsHeaders,
							"Content-Type": "application/json",
						},
					},
				);
			}

			// Get language configuration
			const languageConfig = LANGUAGE_CONFIG[body.language];
			if (!languageConfig) {
				return new Response("Language not supported", {
					status: 400,
					headers: corsHeaders,
				});
			}

			// Execute code for each test case sequentially (more reliable, uses 1 container)
			const results = await this.executeCodeSequential(
				body.code,
				body.testCases,
				languageConfig,
				env,
			);

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

	async executeCodeSequential(
		code: string,
		testCases: Array<{ stdin: string; timeLimitMs: number; memoryLimit: number }>,
		languageConfig: LanguageConfig,
		env: Env,
	): Promise<ExecutionResult[]> {
		// Create a single sandbox for all test cases
		const sandboxId = `exec-seq-${Date.now()}-${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		const sandbox = getSandbox(env.ExecutionSandbox, sandboxId);

		try {
			console.log("starting sequential execution on sandbox", sandboxId);
			await sandbox.exec("echo 'Hello, world!'"); // allow container to start

			// Write the code file once (compilation will happen once)
			const fileName =
				languageConfig.extension === ".java"
					? "/app/Main.java"
					: `/app/code${languageConfig.extension}`;

			// For compiled languages, write code without stdin setup first
			let codeForCompilation = code;
			if (languageConfig.extension === ".java" && !code.includes("class Main")) {
				codeForCompilation = `public class Main {\n    public static void main(String[] args) {\n${code}\n    }\n}`;
			}

			await sandbox.writeFile(fileName, codeForCompilation);

			// Compile once if necessary
			if (languageConfig.isCompiled && languageConfig.compileCommand) {
				console.log("compiling once on sandbox", sandboxId);
				const compileResult = await sandbox.exec(languageConfig.compileCommand);
				console.log("finished compiling on sandbox", sandboxId);

				// Check for compilation errors
				if (compileResult.exitCode !== 0) {
					// Return compilation error for all test cases
					return testCases.map((_, index) => ({
						testCaseIndex: index,
						stdout: "",
						stderr: compileResult.stderr || "Compilation failed",
						exitCode: compileResult.exitCode,
						memoryKB: 0,
						timeMS: 0,
						timedOut: false,
						memoryExceeded: false,
						error: "Compilation failed",
					}));
				}
			}

			// Execute each test case sequentially
			const results: ExecutionResult[] = [];
			for (let i = 0; i < testCases.length; i++) {
				const testCase = testCases[i];
				console.log(`running test case ${i + 1}/${testCases.length} on sandbox`, sandboxId);

				try {
					// For interpreted languages, rewrite the file with stdin setup for each test case
					if (!languageConfig.isCompiled) {
						const setupCode = languageConfig.setupStdin?.(testCase.stdin) || "";
						const finalCode = setupCode + code;
						await sandbox.writeFile(fileName, finalCode);
					}

					// For compiled languages, write stdin to file
					let stdinFile = "";
					if (languageConfig.isCompiled) {
						await sandbox.writeFile("/app/stdin.txt", testCase.stdin);
						stdinFile = " < /app/stdin.txt";
					}

					// Execute with monitoring
					const monitorCommand = `/usr/local/bin/monitor.sh ${testCase.timeLimitMs / 1000} ${testCase.memoryLimit} "${languageConfig.executeCommand}${stdinFile}"`;
					const result = await sandbox.exec(monitorCommand);

					const outputLines = (result.stdout || "").trim().split("\n");
					const memoryKB = outputLines.pop();
					const timeMS = outputLines.pop();
					const programOutput = outputLines.join("\n");

						results.push({
							testCaseIndex: i,
							stdout: programOutput,
							stderr: result.stderr || "",
							exitCode: result.exitCode || 0,
							memoryKB: parseInt(memoryKB || "0"),
							timeMS: parseInt(timeMS || "0"),
							timedOut: result.exitCode === 124,
							memoryExceeded: result.exitCode === 137,
						});
				} catch (testError) {
					console.error(`Error executing test case ${i}:`, testError);
					results.push({
						testCaseIndex: i,
						stdout: "",
						stderr: testError instanceof Error ? testError.message : "Unknown error",
						exitCode: 1,
						memoryKB: 0,
						timeMS: 0,
						timedOut: testError instanceof Error && testError.message.includes("timeout"),
						memoryExceeded: false,
						error: testError instanceof Error ? testError.message : "Unknown error",
					});
				}
			}

			console.log("finished sequential execution on sandbox", sandboxId);
			return results;

		} catch (error) {
			console.error("Sequential execution error:", error);
			// Return error for all test cases
			return testCases.map((_, index) => ({
				testCaseIndex: index,
				stdout: "",
				stderr: error instanceof Error ? error.message : "Unknown error",
				exitCode: 1,
				memoryKB: 0,
				timeMS: 0,
				timedOut: false,
				memoryExceeded: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}));
		} finally {
			// ALWAYS destroy the sandbox container
			try {
				console.log("destroying sequential sandbox", sandboxId);
				await sandbox.destroy();
				console.log("destroyed sequential sandbox", sandboxId);
			} catch (destroyError) {
				console.error("Error destroying sequential sandbox:", sandboxId, destroyError);
			}
		}
	},

	async executeCodeStreaming(
		code: string,
		testCases: Array<{ stdin: string; timeLimitMs: number; memoryLimit: number }>,
		languageConfig: LanguageConfig,
		env: Env,
		webSocket: WebSocket
	): Promise<void> {
		const sandboxId = `exec-stream-${Date.now()}-${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		const sandbox = getSandbox(env.ExecutionSandbox, sandboxId);

		try {
			console.log("starting streaming execution on sandbox", sandboxId);
			await sandbox.exec("echo 'Hello, world!'");

			// Write the code file once
			const fileName =
				languageConfig.extension === ".java"
					? "/app/Main.java"
					: `/app/code${languageConfig.extension}`;

			let codeForCompilation = code;
			if (languageConfig.extension === ".java" && !code.includes("class Main")) {
				codeForCompilation = `public class Main {\n    public static void main(String[] args) {\n${code}\n    }\n}`;
			}

			await sandbox.writeFile(fileName, codeForCompilation);

			// Compile once if necessary
			if (languageConfig.isCompiled && languageConfig.compileCommand) {
				console.log("compiling for streaming execution on sandbox", sandboxId);
				const compileResult = await sandbox.exec(languageConfig.compileCommand);

				if (compileResult.exitCode !== 0) {
					webSocket.send(JSON.stringify({
						type: 'compilation_error',
						data: compileResult.stderr || "Compilation failed"
					} as WebSocketMessage));
					return;
				}
			}

			// Stream results for each test case
			for (let i = 0; i < testCases.length; i++) {
				const testCase = testCases[i];
				console.log(`streaming test case ${i + 1}/${testCases.length} on sandbox`, sandboxId, testCase);

				try {
					// For interpreted languages, rewrite the file with stdin setup for each test case
					if (!languageConfig.isCompiled) {
						const setupCode = languageConfig.setupStdin?.(testCase.stdin) || "";
						const finalCode = setupCode + code;
						await sandbox.writeFile(fileName, finalCode);
					}

					// For compiled languages, write stdin to file
					let stdinFile = "";
					if (languageConfig.isCompiled) {
						await sandbox.writeFile("/app/stdin.txt", testCase.stdin);
						stdinFile = " < /app/stdin.txt";
					}

					// Execute with monitoring
					const monitorCommand = `/usr/local/bin/monitor.sh ${testCase.timeLimitMs / 1000} ${testCase.memoryLimit} "${languageConfig.executeCommand}${stdinFile}"`;
					const result = await sandbox.exec(monitorCommand);

					const outputLines = (result.stdout || "").trim().split("\n");
					console.log("outputLines", outputLines);
					const memoryKB = outputLines.pop();
					const timeMS = outputLines.pop();
					const programOutput = outputLines.join("\n");

					const executionResult: ExecutionResult = {
						testCaseIndex: i,
						stdout: programOutput,
						stderr: result.stderr || "",
						exitCode: result.exitCode || 0,
						memoryKB: parseInt(memoryKB || "0"),
						timeMS: parseInt(timeMS || "0"),
						timedOut: result.exitCode === 143,
						memoryExceeded: result.exitCode === 134,
					};

					// Stream the result immediately
					webSocket.send(JSON.stringify({
						type: 'result',
						data: executionResult,
						totalTestCases: testCases.length
					} as WebSocketMessage));

				} catch (testError) {
					console.error(`Error executing test case ${i}:`, testError);
					const errorResult: ExecutionResult = {
						testCaseIndex: i,
						stdout: "",
						stderr: testError instanceof Error ? testError.message : "Unknown error",
						exitCode: 1,
						memoryKB: 0,
						timeMS: 0,
						timedOut: testError instanceof Error && testError.message.includes("timeout"),
						memoryExceeded: false,
						error: testError instanceof Error ? testError.message : "Unknown error",
					};

					webSocket.send(JSON.stringify({
						type: 'result',
						data: errorResult,
						totalTestCases: testCases.length
					} as WebSocketMessage));
				}
			}

			// Send completion signal
			webSocket.send(JSON.stringify({
				type: 'complete'
			} as WebSocketMessage));

			console.log("finished streaming execution on sandbox", sandboxId);

		} catch (error) {
			console.error("Streaming execution error:", error);
			webSocket.send(JSON.stringify({
				type: 'error',
				data: error instanceof Error ? error.message : 'Unknown error'
			} as WebSocketMessage));
		} finally {
			try {
				console.log("destroying streaming sandbox", sandboxId);
				await sandbox.destroy();
				console.log("destroyed streaming sandbox", sandboxId);
			} catch (destroyError) {
				console.error("Error destroying streaming sandbox:", sandboxId, destroyError);
			}
		}
	},
};
