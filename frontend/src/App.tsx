import { Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from './contexts/AuthContext';
import CodeExecutionPage from "./pages/CodeExecutionPage";
import AuthPage from './pages/AuthPage';
import { Button } from './components/ui/button';

function Navigation() {
  const { user, logout, isLoading } = useAuth();

  if (isLoading) {
    return (
      <nav className="bg-white shadow-sm border-b p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800">Ukoly Platform</h1>
          <div>Loading...</div>
        </div>
      </nav>
    );
  }

  return (
    <nav className="bg-white shadow-sm border-b p-4">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">Ukoly Platform</h1>
        {user ? (
          <div className="flex items-center space-x-4">
            <span className="text-gray-600">Welcome, {user.username}</span>
            {user.isAdmin && (
              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded">
                Admin
              </span>
            )}
            <Button onClick={logout} variant="outline" size="sm">
              Logout
            </Button>
          </div>
        ) : (
          <div className="text-gray-600">Please log in</div>
        )}
      </div>
    </nav>
  );
}

function AppContent() {
  return (
    <Router>
      <div className="min-h-screen bg-background">
        <Navigation />
        <Routes>
          <Route 
            path="/auth" 
            element={<AuthPage />} 
          />
          <Route 
            path="/execute" 
            element={<CodeExecutionPage />}
          />
        </Routes>
      </div>
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
