// vibe coded trash

import { useState, useRef, useCallback, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Play, Code, Settings, Square, Shield } from "lucide-react";

type Language = "javascript" | "python" | "c" | "cpp" | "rust" | "java";

interface TestCase {
	stdin: string;
	timeLimitMs: number;
	memoryLimit: number;
}

interface TestResult {
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
	data?: TestResult | string;
	totalTestCases?: number;
}

interface ExecutionStatus {
	isExecuting: boolean;
	currentTestCase: number;
	totalTestCases: number;
	isComplete: boolean;
}

interface TurnstileState {
	isLoaded: boolean;
	token: string | null;
	isVerified: boolean;
	error: string | null;
}

// Declare turnstile on window for TypeScript
declare global {
	interface Window {
		turnstile?: {
			render: (element: string, options: any) => string;
			reset: (widgetId?: string) => void;
			getResponse: (widgetId?: string) => string;
			remove: (widgetId?: string) => void;
		};
		onTurnstileLoad?: () => void;
	}
}

const LANGUAGE_TEMPLATES: Record<Language, string> = {
	javascript: `const x = input();
const y = input();

console.log((+x) + (+y));`,

	python: `x = int(input())
y = int(input())

ans = x + y
print(ans)`,

	cpp: `#include <iostream>
using namespace std;

int main() {
    int x, y;
    cin >> x >> y;
    cout << x + y << endl;
    return 0;
}`,

	c: `#include <stdio.h>

int main() {
    int x, y;
    scanf("%d %d", &x, &y);
    printf("%d\\n", x + y);
    return 0;
}`,

	rust: `use std::io;

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let x: i32 = input.trim().parse().unwrap();
    
    input.clear();
    io::stdin().read_line(&mut input).unwrap();
    let y: i32 = input.trim().parse().unwrap();
    
    println!("{}", x + y);
}`,

	java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int x = scanner.nextInt();
        int y = scanner.nextInt();
        System.out.println(x + y);
        scanner.close();
    }
}`,
};

const LANGUAGE_INFO: Record<
	Language,
	{ name: string; monacoLanguage: string; icon: string }
> = {
	javascript: { name: "JavaScript", monacoLanguage: "javascript", icon: "🟨" },
	python: { name: "Python", monacoLanguage: "python", icon: "🐍" },
	cpp: { name: "C++", monacoLanguage: "cpp", icon: "⚡" },
	c: { name: "C", monacoLanguage: "c", icon: "🔧" },
	rust: { name: "Rust (Unsupported)", monacoLanguage: "rust", icon: "🦀" },
	java: { name: "Java (Unsupported)", monacoLanguage: "java", icon: "☕" },
};

export default function CodeExecutionPage() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<Language>("javascript");
	const [code, setCode] = useState(LANGUAGE_TEMPLATES.javascript);
	const [testCasesInput, setTestCasesInput] = useState(`3
4
===
1000
2000`);
	const [results, setResults] = useState<TestResult[]>([]);
	const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>({
		isExecuting: false,
		currentTestCase: 0,
		totalTestCases: 0,
		isComplete: false,
	});
	const [compilationError, setCompilationError] = useState<string>("");
	const [executionError, setExecutionError] = useState<string>("");
	const [turnstileState, setTurnstileState] = useState<TurnstileState>({
		isLoaded: false,
		token: null,
		isVerified: false,
		error: null,
	});
	
	const wsRef = useRef<WebSocket | null>(null);
	const turnstileWidgetRef = useRef<string | null>(null);

	const renderTurnstile = useCallback(() => {
		if (!window.turnstile || turnstileWidgetRef.current) return;

		try {
			const widgetId = window.turnstile.render('#turnstile-container', {
				sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
				callback: (token: string) => {
					setTurnstileState(prev => ({
						...prev,
						token,
						isVerified: true,
						error: null,
					}));
				},
				'error-callback': (error: string) => {
					setTurnstileState(prev => ({
						...prev,
						token: null,
						isVerified: false,
						error: `Turnstile error: ${error}`,
					}));
				},
				'expired-callback': () => {
					setTurnstileState(prev => ({
						...prev,
						token: null,
						isVerified: false,
						error: 'Turnstile token expired. Please verify again.',
					}));
				},
				theme: 'light',
				size: 'normal',
			});
			
			turnstileWidgetRef.current = widgetId;
		} catch (error) {
			console.error('Failed to render Turnstile:', error);
			setTurnstileState(prev => ({
				...prev,
				error: 'Failed to load security verification',
			}));
		}
	}, []);

	// Add Turnstile script to page
	useEffect(() => {
		// Check if Turnstile is already loaded and available
		if (window.turnstile) {
			setTurnstileState(prev => ({ ...prev, isLoaded: true }));
			renderTurnstile();
			return;
		}

		// Check if script already exists
		const existingScript = document.querySelector('script[src*="turnstile"]');
		if (existingScript) {
			// Script exists but callback might be missing, re-add it
			window.onTurnstileLoad = () => {
				setTurnstileState(prev => ({ ...prev, isLoaded: true }));
				renderTurnstile();
			};
			// If turnstile is already available, call it directly
			if (window.turnstile) {
				window.onTurnstileLoad();
			}
			return;
		}

		// Define the global callback BEFORE loading the script
		window.onTurnstileLoad = () => {
			setTurnstileState(prev => ({ ...prev, isLoaded: true }));
			renderTurnstile();
		};

		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
		script.async = true;
		script.defer = true;

		document.head.appendChild(script);

		// No cleanup! Let the script and callback persist
	}, [renderTurnstile]);

	const resetTurnstile = useCallback(() => {
		if (window.turnstile && turnstileWidgetRef.current) {
			window.turnstile.reset(turnstileWidgetRef.current);
			setTurnstileState(prev => ({
				...prev,
				token: null,
				isVerified: false,
				error: null,
			}));
		}
	}, []);

	const handleLanguageChange = (language: Language) => {
		setSelectedLanguage(language);
		setCode(LANGUAGE_TEMPLATES[language]);
	};

	const parseTestCases = (input: string): TestCase[] => {
		return input.split("===").map((testCase) => ({
			stdin: testCase.trim(),
			timeLimitMs: 1000, // 1 second
			memoryLimit: 1024 * 1024, // 1MB
		}));
	};

	const stopExecution = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		setExecutionStatus(prev => ({
			...prev,
			isExecuting: false,
		}));
	}, []);

	const executeCode = async () => {
		// Check Turnstile verification
		if (!turnstileState.isVerified || !turnstileState.token) {
			setExecutionError("Please complete the security verification before executing code.");
			return;
		}

		// Reset state
		setResults([]);
		setCompilationError("");
		setExecutionError("");
		setExecutionStatus({
			isExecuting: true,
			currentTestCase: 0,
			totalTestCases: 0,
			isComplete: false,
		});

		try {
			const testCases = parseTestCases(testCasesInput);
			
			// Create WebSocket connection
			const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const wsUrl = `${wsProtocol}//${import.meta.env.VITE_API_URL.replace(/^https?:\/\//, '')}/api/execute-stream`;
			
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				console.log("WebSocket connected");
				// Send execution request with Turnstile token
				ws.send(JSON.stringify({
					code,
					language: selectedLanguage,
					testCases,
					turnstileToken: turnstileState.token, // Include Turnstile token
				}));
			};

			ws.onmessage = (event) => {
				const message: WebSocketMessage = JSON.parse(event.data);
				
				switch (message.type) {
					case 'result': {
						const result = message.data as TestResult;
						setResults(prev => {
							const newResults = [...prev];
							newResults[result.testCaseIndex] = result;
							return newResults;
						});
						setExecutionStatus(prev => ({
							...prev,
							currentTestCase: result.testCaseIndex + 1,
							totalTestCases: message.totalTestCases || prev.totalTestCases,
						}));
						break;
					}
						
					case 'compilation_error':
						setCompilationError(message.data as string);
						setExecutionStatus(prev => ({
							...prev,
							isExecuting: false,
							isComplete: true,
						}));
						// Reset Turnstile after use
						resetTurnstile();
						break;
						
					case 'error':
						setExecutionError(message.data as string);
						setExecutionStatus(prev => ({
							...prev,
							isExecuting: false,
							isComplete: true,
						}));
						// Reset Turnstile after use
						resetTurnstile();
						break;
						
					case 'complete':
						setExecutionStatus(prev => ({
							...prev,
							isExecuting: false,
							isComplete: true,
						}));
						// Reset Turnstile after successful execution
						resetTurnstile();
						break;
				}
			};

			ws.onerror = (error) => {
				console.error("WebSocket error:", error);
				setExecutionError("Connection error occurred");
				setExecutionStatus(prev => ({
					...prev,
					isExecuting: false,
				}));
				resetTurnstile();
			};

			ws.onclose = () => {
				console.log("WebSocket connection closed");
				wsRef.current = null;
				setExecutionStatus(prev => ({
					...prev,
					isExecuting: false,
				}));
			};

		} catch (error) {
			console.error("Error executing code:", error);
			setExecutionError(error instanceof Error ? error.message : "Unknown error");
			setExecutionStatus(prev => ({
				...prev,
				isExecuting: false,
			}));
			resetTurnstile();
		}
	};

	return (
		<div className="container mx-auto p-6 max-w-6xl">
			<div className="mb-6">
				<h1 className="text-3xl font-bold flex items-center gap-2">
					<Code className="h-8 w-8" />
					Code Execution Platform
				</h1>
				<p className="text-muted-foreground mt-2">
					Write code in multiple languages and test it with multiple test cases
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Code Editor */}
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-xl font-semibold">Code Editor</h2>
						<div className="flex items-center gap-2">
							<Settings className="h-4 w-4" />
							<Select
								value={selectedLanguage}
								onValueChange={handleLanguageChange}
								disabled={executionStatus.isExecuting}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue placeholder="Select language" />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(LANGUAGE_INFO).map(([lang, info]) => (
										<SelectItem key={lang} value={lang}>
											<span className="flex items-center gap-2">
												<span>{info.icon}</span>
												<span>{info.name}</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="border rounded-lg overflow-hidden">
						<Editor
							height="400px"
							language={LANGUAGE_INFO[selectedLanguage].monacoLanguage}
							value={code}
							onChange={(value) => setCode(value || "")}
							theme="vs-dark"
							options={{
								minimap: { enabled: false },
								fontSize: 14,
								lineNumbers: "on",
								roundedSelection: false,
								scrollBeyondLastLine: false,
								automaticLayout: true,
								readOnly: executionStatus.isExecuting,
							}}
						/>
					</div>
				</div>

				{/* Test Cases Input */}
				<div className="space-y-4">
					<h2 className="text-xl font-semibold">Test Cases</h2>
					<div className="space-y-2">
						<label htmlFor="test-cases-input" className="text-sm font-medium">
							Input (separate with ===)
						</label>
						<textarea
							id="test-cases-input"
							value={testCasesInput}
							onChange={(e) => setTestCasesInput(e.target.value)}
							disabled={executionStatus.isExecuting}
							className="w-full h-96 p-3 border rounded-lg resize-none font-mono text-sm disabled:opacity-50"
							placeholder="Enter test cases separated by ==="
						/>
					</div>

					{/* Security Verification Section */}
					<div className="space-y-3 p-4 border rounded-lg bg-slate-50">
						<div className="flex items-center gap-2">
							<Shield className="h-4 w-4" />
							<span className="text-sm font-medium">Security Verification</span>
						</div>
						
						{/* Turnstile Widget Container */}
						<div id="turnstile-container" className="flex justify-center"></div>
						
						{/* Turnstile Status */}
						{turnstileState.error && (
							<div className="text-sm text-red-600 text-center">
								{turnstileState.error}
							</div>
						)}
						
						{turnstileState.isVerified && (
							<div className="text-sm text-green-600 text-center flex items-center justify-center gap-1">
								<Shield className="h-3 w-3" />
								Verification completed
							</div>
						)}
						
						{turnstileState.isLoaded && !turnstileState.isVerified && !turnstileState.error && (
							<div className="text-sm text-gray-600 text-center">
								Please complete the verification above
							</div>
						)}
						
						{!turnstileState.isLoaded && (
							<div className="text-sm text-gray-600 text-center">
								Loading security verification...
							</div>
						)}
					</div>

					{/* Execution Progress */}
					{executionStatus.isExecuting && (
						<div className="space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium text-blue-800">
									Executing Test Cases...
								</span>
								<span className="text-sm text-blue-600">
									{executionStatus.currentTestCase}/{executionStatus.totalTestCases || '?'}
								</span>
							</div>
							{executionStatus.totalTestCases > 0 && (
								<div className="w-full bg-blue-200 rounded-full h-2">
									<div
										className="bg-blue-600 h-2 rounded-full transition-all duration-300"
										style={{
											width: `${(executionStatus.currentTestCase / executionStatus.totalTestCases) * 100}%`,
										}}
									/>
								</div>
							)}
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex gap-2">
						<Button
							onClick={executeCode}
							disabled={executionStatus.isExecuting || !turnstileState.isVerified}
							className="flex-1"
						>
							<Play className="h-4 w-4 mr-2" />
							{executionStatus.isExecuting
								? "Executing..."
								: `Execute ${LANGUAGE_INFO[selectedLanguage].name} Code`}
						</Button>
						
						{executionStatus.isExecuting && (
							<Button
								onClick={stopExecution}
								variant="destructive"
								size="icon"
							>
								<Square className="h-4 w-4" />
							</Button>
						)}
					</div>
				</div>
			</div>

			{/* Compilation Error */}
			{compilationError && (
				<div className="mt-8 space-y-4">
					<h2 className="text-xl font-semibold text-red-600">Compilation Error</h2>
					<div className="border border-red-200 rounded-lg p-4 bg-red-50">
						<pre className="text-sm text-red-800 overflow-auto whitespace-pre-wrap">
							{compilationError}
						</pre>
					</div>
				</div>
			)}

			{/* Execution Error */}
			{executionError && (
				<div className="mt-8 space-y-4">
					<h2 className="text-xl font-semibold text-red-600">Execution Error</h2>
					<div className="border border-red-200 rounded-lg p-4 bg-red-50">
						<p className="text-sm text-red-800">{executionError}</p>
					</div>
				</div>
			)}

			{/* Streaming Results */}
			{(results.length > 0 || executionStatus.isExecuting) && (
				<div className="mt-8 space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-xl font-semibold">Execution Results</h2>
						{executionStatus.isComplete && (
							<span className="text-sm text-green-600 font-medium">
								✓ All test cases completed
							</span>
						)}
					</div>
					<div className="space-y-4">
						{Array.from({ length: Math.max(results.length, executionStatus.totalTestCases || 0) }, (_, i) => {
							const result = results[i];
							const isExecuting = executionStatus.isExecuting && i === executionStatus.currentTestCase && !result;
							const isPending = i >= executionStatus.currentTestCase && !result;

							return (
								<div
									key={result?.testCaseIndex !== undefined ? `result-${result.testCaseIndex}` : `pending-${i}`}
									className={`border rounded-lg p-4 transition-all duration-300 ${
										result
											? "bg-muted/50"
											: isExecuting
											? "bg-blue-50 border-blue-200"
											: "bg-gray-50 border-gray-200"
									}`}
								>
									<div className="flex items-center gap-2 mb-2">
										<span className="font-semibold">
											Test Case {i + 1}
										</span>
										{result && (
											<span
												className={`px-2 py-1 rounded text-xs font-medium ${
													result.exitCode === 0 &&
													!result.timedOut &&
													!result.memoryExceeded
														? "bg-green-100 text-green-800"
														: "bg-red-100 text-red-800"
												}`}
											>
												{result.exitCode === 0 &&
												!result.timedOut &&
												!result.memoryExceeded
													? "PASSED"
													: "FAILED"}
											</span>
										)}
										{isExecuting && (
											<span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 animate-pulse">
												RUNNING...
											</span>
										)}
										{isPending && !isExecuting && (
											<span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
												PENDING
											</span>
										)}
										{result && (
											<span className="text-xs text-muted-foreground">
												{result.timeMS}ms, {result.memoryKB}KB
											</span>
										)}
									</div>

									{result && result.stdout && (
										<div className="mb-2">
											<p className="text-sm font-medium">Output:</p>
											<pre className="text-sm bg-background p-2 rounded border overflow-auto">
												{result.stdout}
											</pre>
										</div>
									)}

									{result && result.stderr && (
										<div className="mb-2">
											<p className="text-sm font-medium text-red-600">Error:</p>
											<pre className="text-sm bg-red-50 p-2 rounded border overflow-auto text-red-800">
												{result.stderr}
											</pre>
										</div>
									)}

									{result && (result.timedOut || result.memoryExceeded || result.error) && (
										<div className="text-sm text-red-600">
											{result.timedOut && <p>⏰ Time limit exceeded</p>}
											{result.memoryExceeded && <p>💾 Memory limit exceeded</p>}
											{result.error && <p>❌ {result.error}</p>}
										</div>
									)}

									{isExecuting && (
										<div className="text-sm text-blue-600 animate-pulse">
											⚡ Executing...
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
