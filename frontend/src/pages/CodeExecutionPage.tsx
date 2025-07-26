import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Play, Code } from 'lucide-react'

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

export default function CodeExecutionPage() {
  const [code, setCode] = useState(`const x = input();
const y = input();

const aX = Array(+x).fill(0);
const aY = Array(+y).fill(0);

let ans = 0;
for (const _ of [...aX, ...aY]) {
    ans += 1;
}

console.log(ans);
`)
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

  const parseTestCases = (input: string): TestCase[] => {
    return input.split('===').map((testCase, index) => ({
      stdin: testCase.trim(),
      timeLimit: 1000, // 1 second
      memoryLimit: 1024 * 1024 // 1MB
    }))
  }

  const executeCode = async () => {
    setIsExecuting(true)
    try {
      const testCases = parseTestCases(testCasesInput)
      
      const response = await fetch('http://localhost:8787/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Secret-Token': 'dev-secret-token-123'
        },
        body: JSON.stringify({
          code,
          language: 'javascript',
          testCases
        })
      })

      if (response.ok) {
        const data = await response.json()
        setResults(data.results)
      } else {
        console.error('Execution failed:', response.statusText)
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
          Write JavaScript code and test it with multiple test cases
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Code Editor */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Code Editor</h2>
          <div className="border rounded-lg overflow-hidden">
            <Editor
              height="400px"
              defaultLanguage="javascript"
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
            <label className="text-sm font-medium">Input (separate with ===)</label>
            <textarea
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
            {isExecuting ? 'Executing...' : 'Execute Code'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold">Execution Results</h2>
          <div className="border rounded-lg p-4 bg-muted/50">
            <pre className="text-sm overflow-auto max-h-96">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
} 