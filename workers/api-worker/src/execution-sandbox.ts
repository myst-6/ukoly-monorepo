import { Sandbox } from "@cloudflare/sandbox";

export interface ExecutionInput {
	stdin: string;
	timeLimitMs: number;
	memoryLimit: number;
}

export interface ExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	memoryKB: number;
	timeMS: number;
	timedOut: boolean;
	memoryExceeded: boolean;
	error?: string;
}

export type LanguageConfig =  {
	isCompiled: true;
	compileCommand: string;
	executeCommand: string;
    sourceFile: string;
    compileFile: string;
} | {
    isCompiled: false;
    setupStdin?: (code: string, stdin: string) => string;
    executeCommand: string;
    sourceFile: string;
}

export type Language = "javascript" | "cpp" | "c" | "python";

export const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
	javascript: {
		isCompiled: false,
		sourceFile: "/app/code.js",
		executeCommand: "node /app/code.js",
		setupStdin: (code: string, stdin: string) => {
			const encodedStdin = btoa(stdin);
			return `
// Setup input handling
const input = (lines => () => lines.pop() || "")(atob("${encodedStdin}").split("\\n").map(line => line.trim()).reverse());

// Execute user code in an IIFE to avoid global variable pollution
(() => {
${code}
})();
`;
		},
	},
	cpp: {
		isCompiled: true,
		sourceFile: "/app/code.cpp",
		compileFile: "/app/executable",
		compileCommand: "g++ -std=c++17 -O2 -o /app/executable /app/code.cpp",
		executeCommand: "/app/executable",
	},
	c: {
		isCompiled: true,
		compileCommand: "gcc -std=c11 -O2 -o /app/executable /app/code.c",
		executeCommand: "/app/executable",
		sourceFile: "/app/code.c",
		compileFile: "/app/executable",
	},
	python: {
		isCompiled: false,
		sourceFile: "/app/code.py",
		executeCommand: "python3 /app/code.py",
		setupStdin: (code: string, stdin: string) => {
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
${code}
`;
		},
	},
};

// Handles multiple test cases sequentially, sleeps after 20s
export class ExecutionSandbox extends Sandbox {
	defaultPort = 3000;
	sleepAfter = "20s";
}

export class SandboxRuntime {
    constructor(private sandbox: DurableObjectStub<Sandbox<unknown>>, private languageConfig: LanguageConfig, private code: string) {}
    compiled: boolean = false;
    stdinFile = "/app/stdin.txt" as const;

    async writeCode(code: string) {
        await this.sandbox.writeFile(this.languageConfig.sourceFile, code);
    }

    async writeStdin(stdin: string) {
        await this.sandbox.writeFile(this.stdinFile, stdin);
    }

    async compileIfNeeded() {
        if (!this.languageConfig.isCompiled)
            return true;
        
        await this.writeCode(this.code);
        const compileResult = await this.sandbox.exec(this.languageConfig.compileCommand);
        this.compiled = compileResult.exitCode === 0;
        return this.compiled;
    }

    async injectStdin(stdin: string) {
        if (this.languageConfig.isCompiled)
            return this.code;
        const injectedCode = this.languageConfig.setupStdin?.(this.code, stdin) || this.code;
        return injectedCode;
    }

    async executeTimed(timeLimitMs: number, memoryLimitKb: number): Promise<ExecutionResult> {
        const monitorCommand = `/usr/local/bin/monitor.sh ${timeLimitMs / 1000} ${memoryLimitKb} "${this.languageConfig.executeCommand} < ${this.stdinFile}"`;
        const result = await this.sandbox.exec(monitorCommand);

        console.log("monitor command", monitorCommand);
        console.log("result", result);

        const outputLines = (result.stdout || "").trim().split("\n");
        const memoryKB = outputLines.pop();
        const timeMS = outputLines.pop();
        const programOutput = outputLines.join("\n");

        const executionResult: ExecutionResult = {
            stdout: programOutput,
            stderr: result.stderr || "",
            exitCode: result.exitCode || 0,
            memoryKB: parseInt(memoryKB || "0"),
            timeMS: parseInt(timeMS || "0"),
            timedOut: result.exitCode === 143,
            memoryExceeded: result.exitCode === 134,
        };

        return executionResult;
    }

    async run(input: ExecutionInput): Promise<ExecutionResult> {
        await this.writeStdin(input.stdin);
        await this.writeCode(await this.injectStdin(input.stdin));
        await this.compileIfNeeded();
        return await this.executeTimed(input.timeLimitMs, input.memoryLimit);
    }
}
