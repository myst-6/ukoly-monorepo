import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { RateLimiter } from "./rate-limiter";

// Sandbox for executing code
// Will only execute one test case so can sleep after 20s
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
		setupStdin: (stdin: string) => {
			// C++ reads from stdin directly, so we don't need to modify the code
			// The monitor script will pipe the stdin to the process
			return "";
		},
	},
	c: {
		extension: ".c",
		isCompiled: true,
		compileCommand: "gcc -std=c11 -O2 -o /app/executable /app/code.c",
		executeCommand: "/app/executable",
		setupStdin: (stdin: string) => {
			return "";
		},
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
		setupStdin: (stdin: string) => {
			return "";
		},
	},
	java: {
		extension: ".java",
		isCompiled: true,
		compileCommand: "javac -d /app /app/Main.java",
		executeCommand: "java -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -cp /app Main",
		setupStdin: (stdin: string) => {
			// Java code needs to be wrapped in a Main class
			return "";
		},
	},
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// CORS headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};

		// Handle preflight requests
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);

		// CORS disabled for now - allow all origins
		// const origin = request.headers.get("Origin");
		// const allowedOrigins = [
		// 	"http://localhost:5173",
		// 	"https://ukoly.monorepo.workers.dev", // for production
		// ];

		// if (!allowedOrigins.includes(origin || "")) {
		// 	return new Response("Forbidden", {
		// 		status: 403,
		// 		headers: corsHeaders,
		// 	});
		// }

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

			// Execute code for each test case in parallel
			const executionPromises = body.testCases.map(async (testCase, index) => {
				const result = await this.executeCode(
					body.code,
					testCase,
					languageConfig,
					env,
				);
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

	async executeCode(
		code: string,
		testCase: { stdin: string; timeLimit: number; memoryLimit: number },
		languageConfig: LanguageConfig,
		env: Env,
	): Promise<Omit<ExecutionResult, "testCaseIndex">> {
		// Create a unique sandbox ID for this execution
		const sandboxId = `exec-${Date.now()}-${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		const sandbox = getSandbox(env.ExecutionSandbox, sandboxId);

		try {
			await sandbox.exec("echo 'Hello, world!'"); // allow container to start before doing file I/O)

			// Prepare the code with stdin setup if needed
			let finalCode = code;
			if (languageConfig.setupStdin) {
				const setupCode = languageConfig.setupStdin(testCase.stdin);
				finalCode = setupCode + code;
			}

			// Write the code to a file (special handling for Java)
			const fileName =
				languageConfig.extension === ".java"
					? "/app/Main.java"
					: `/app/code${languageConfig.extension}`;

			// For Java, wrap the code in a Main class if it's not already wrapped
			if (
				languageConfig.extension === ".java" &&
				!finalCode.includes("class Main")
			) {
				finalCode = `public class Main {\n    public static void main(String[] args) {\n${finalCode}\n    }\n}`;
			}

			await sandbox.writeFile(fileName, finalCode);

			// Compile if necessary
			if (languageConfig.isCompiled && languageConfig.compileCommand) {
				console.log("compiling on sandbox", sandboxId);
				const compileResult = await sandbox.exec(languageConfig.compileCommand);
				console.log("finished compiling on sandbox", sandboxId);

				// Check for compilation errors
				if (compileResult.exitCode !== 0) {
					return {
						stdout: "",
						stderr: compileResult.stderr || "Compilation failed",
						exitCode: compileResult.exitCode,
						maxMemoryUsed: 0,
						executionTime: 0,
						timedOut: false,
						memoryExceeded: false,
						error: "Compilation failed",
					};
				}
			}

			// For compiled languages that use stdin directly, write stdin to a file for the monitor script
			let stdinFile = "";
			if (languageConfig.isCompiled && testCase.stdin) {
				await sandbox.writeFile("/app/stdin.txt", testCase.stdin);
				stdinFile = " < /app/stdin.txt";
			}

			// Execute with monitoring script for immediate limit enforcement
			const monitorCommand = `/usr/local/bin/monitor.sh ${testCase.timeLimit} ${testCase.memoryLimit} "${languageConfig.executeCommand}${stdinFile}"`;
			console.log("running on sandbox", sandboxId);
			const result = await sandbox.exec(monitorCommand);
			console.log("finished running on sandbox", sandboxId);

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
				console.error("JSON parsing error:", parseError);
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
			console.error("Sandbox execution error:", error);
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
				console.log("destroying sandbox", sandboxId);
				await sandbox.destroy();
				console.log("destroyed sandbox", sandboxId);
			} catch (destroyError) {
				console.error("Error destroying sandbox:", sandboxId, destroyError);
				// Don't throw here - we want to return the original result even if cleanup fails
			}
		}
	},
};
