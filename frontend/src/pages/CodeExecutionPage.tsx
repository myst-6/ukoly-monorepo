import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Play, Code, Settings } from 'lucide-react'

type Language = 'javascript' | 'python' | 'c' | 'cpp' | 'rust' | 'java'

interface TestCase {
  stdin: string
  timeLimit: number
  memoryLimit: number
}

interface ExecutionResult {
  testCaseIndex: number
  stdout: string
  stderr: string
  exitCode: number
  maxMemoryUsed: number
  executionTime: number
  timedOut: boolean
  memoryExceeded: boolean
  error?: string
}

const LANGUAGE_TEMPLATES: Record<Language, string> = {
  javascript: `const x = input();
const y = input();

const aX = Array(+x).fill(0);
const aY = Array(+y).fill(0);

let ans = 0;
for (const _ of [...aX, ...aY]) {
    ans += 1;
}

console.log(ans);`,
  
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
}`
}

const LANGUAGE_INFO: Record<Language, { name: string; monacoLanguage: string; icon: string }> = {
  javascript: { name: 'JavaScript', monacoLanguage: 'javascript', icon: '🟨' },
  python: { name: 'Python', monacoLanguage: 'python', icon: '🐍' },
  cpp: { name: 'C++', monacoLanguage: 'cpp', icon: '⚡' },
  c: { name: 'C', monacoLanguage: 'c', icon: '🔧' },
  rust: { name: 'Rust', monacoLanguage: 'rust', icon: '🦀' },
  java: { name: 'Java', monacoLanguage: 'java', icon: '☕' }
}

export default function CodeExecutionPage() {
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('javascript')
  const [code, setCode] = useState(LANGUAGE_TEMPLATES.javascript)
  const [testCasesInput, setTestCasesInput] = useState(`3
4
===
2000000
3000000
===
10000000
80000000`)
  const [results, setResults] = useState<ExecutionResult[]>([])
  const [isExecuting, setIsExecuting] = useState(false)

  const handleLanguageChange = (language: Language) => {
    setSelectedLanguage(language)
    setCode(LANGUAGE_TEMPLATES[language])
  }

  const parseTestCases = (input: string): TestCase[] => {
    return input.split('===').map((testCase) => ({
      stdin: testCase.trim(),
      timeLimit: 1000, // 1 second
      memoryLimit: 1024 * 1024 // 1MB
    }))
  }

  const executeCode = async () => {
    setIsExecuting(true)
    try {
      const testCases = parseTestCases(testCasesInput)
      
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8787'}/api/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          language: selectedLanguage,
          testCases
        })
      })

      if (response.ok) {
        const data = await response.json()
        setResults(data.results)
      } else {
        const errorText = await response.text()
        console.error('Execution failed:', response.statusText, errorText)
        setResults([])
      }
    } catch (error) {
      console.error('Error executing code:', error)
      setResults([])
    } finally {
      setIsExecuting(false)
    }
  }

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
              <Select value={selectedLanguage} onValueChange={handleLanguageChange}>
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
              onChange={(value) => setCode(value || '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>

        {/* Test Cases Input */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Test Cases</h2>
          <div className="space-y-2">
            <label htmlFor="test-cases-input" className="text-sm font-medium">Input (separate with ===)</label>
            <textarea
              id="test-cases-input"
              value={testCasesInput}
              onChange={(e) => setTestCasesInput(e.target.value)}
              className="w-full h-96 p-3 border rounded-lg resize-none font-mono text-sm"
              placeholder="Enter test cases separated by ==="
            />
          </div>
          
          <Button 
            onClick={executeCode} 
            disabled={isExecuting}
            className="w-full"
          >
            <Play className="h-4 w-4 mr-2" />
            {isExecuting ? 'Executing...' : `Execute ${LANGUAGE_INFO[selectedLanguage].name} Code`}
          </Button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold">Execution Results</h2>
          <div className="space-y-4">
            {results.map((result) => (
              <div key={result.testCaseIndex} className="border rounded-lg p-4 bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold">Test Case {result.testCaseIndex + 1}</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    result.exitCode === 0 && !result.timedOut && !result.memoryExceeded
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {result.exitCode === 0 && !result.timedOut && !result.memoryExceeded ? 'PASSED' : 'FAILED'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {result.executionTime}ms, {Math.round(result.maxMemoryUsed / 1024)}KB
                  </span>
                </div>
                
                {result.stdout && (
                  <div className="mb-2">
                    <p className="text-sm font-medium">Output:</p>
                    <pre className="text-sm bg-background p-2 rounded border overflow-auto">
                      {result.stdout}
                    </pre>
                  </div>
                )}
                
                {result.stderr && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-red-600">Error:</p>
                    <pre className="text-sm bg-red-50 p-2 rounded border overflow-auto text-red-800">
                      {result.stderr}
                    </pre>
                  </div>
                )}
                
                {(result.timedOut || result.memoryExceeded || result.error) && (
                  <div className="text-sm text-red-600">
                    {result.timedOut && <p>⏰ Time limit exceeded</p>}
                    {result.memoryExceeded && <p>💾 Memory limit exceeded</p>}
                    {result.error && <p>❌ {result.error}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
} 