import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import type { ComponentType } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { RequireUserAuth } from "./components/RequireUserAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { GlobalSettingsDialogHost } from "./components/SettingsDialog";

import HomePage from "./pages/HomePage";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Library from "./pages/Library";
import Login from "./pages/Login";
// import Projects from "./pages/Projects";
import ProjectDetailWrapper from "./pages/ProjectDetailWrapper";
import ManagerNode from "./pages/ManagerNode";
import ManagerView from "./pages/ManagerView";
import AIWorkspace from "./pages/AIWorkspace";
import AgentProject from "./pages/AgentProject";
import CEOView from "./pages/CEOView";
import TaskDetail from "./pages/TaskDetail";
import Register from "./pages/Register";

function withUserAuth<T extends object>(Component: ComponentType<T>) {
  return function ProtectedComponent(props: T) {
    return (
      <RequireUserAuth>
        <Component {...props} />
      </RequireUserAuth>
    );
  };
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={HomePage} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/home"} component={withUserAuth(Home)} />
      <Route path={"/search"} component={withUserAuth(Search)} />
      <Route path="/library" component={withUserAuth(Library)} />
      <Route path="/projects" component={withUserAuth(ManagerView)} />
      <Route path="/project/:id" component={withUserAuth(ProjectDetailWrapper)} />
      <Route path="/manager-node" component={withUserAuth(ManagerNode)} />
      <Route path="/manager-view" component={withUserAuth(ManagerView)} />
      <Route path="/new-task" component={withUserAuth(Home)} />
      <Route path="/session/:sessionId" component={withUserAuth(Home)} />
      <Route path="/ai-workspace" component={withUserAuth(AIWorkspace)} />
      <Route path="/agent-project" component={withUserAuth(AgentProject)} />
      <Route path="/ceo-view" component={withUserAuth(CEOView)} />
      <Route path="/task/:projectId/:managerId/:taskId" component={withUserAuth(TaskDetail)} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider
          defaultTheme="light"
          // switchable
        >
          <TooltipProvider>
            <Toaster />
            <Router />
            <GlobalSettingsDialogHost />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
