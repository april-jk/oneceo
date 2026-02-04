import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

import HomePage from "./pages/HomePage";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Library from "./pages/Library";
// import Projects from "./pages/Projects";
import ProjectDetailWrapper from "./pages/ProjectDetailWrapper";
import ManagerNode from "./pages/ManagerNode";
import ManagerView from "./pages/ManagerView";
import AIWorkspace from "./pages/AIWorkspace";
import AgentProject from "./pages/AgentProject";
import CEOView from "./pages/CEOView";
import TaskDetail from "./pages/TaskDetail";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={HomePage} />
      <Route path={"/home"} component={Home} />
      <Route path={"/search"} component={Search} />
      <Route path="/library" component={Library} />
      <Route path="/projects" component={ManagerView} />
      <Route path="/project/:id" component={ProjectDetailWrapper} />
      <Route path="/manager-node" component={ManagerNode} />
      <Route path="/manager-view" component={ManagerView} />
      <Route path="/new-task" component={Home} />
      <Route path="/ai-workspace" component={AIWorkspace} />
      <Route path="/agent-project" component={AgentProject} />
      <Route path="/ceo-view" component={CEOView} />
      <Route path="/agent-project" component={AgentProject} />
      <Route path="/task/:projectId/:managerId/:taskId" component={TaskDetail} />
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
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
