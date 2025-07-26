import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import CodeExecutionPage from "./pages/CodeExecutionPage";

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background">
        <Routes>
          <Route path="/" element={<CodeExecutionPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
