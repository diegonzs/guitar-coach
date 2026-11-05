import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import { Home } from "@/pages/Home";

const Lessons = lazy(() => import("@/pages/Lessons"));
const LessonDetail = lazy(() => import("@/pages/LessonDetail"));
const Practice = lazy(() => import("@/pages/Practice"));
const SessionSummary = lazy(() => import("@/pages/SessionSummary"));
const Assessment = lazy(() => import("@/pages/Assessment"));
const Tuner = lazy(() => import("@/pages/Tuner"));
const Progress = lazy(() => import("@/pages/Progress"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Calibrate = lazy(() => import("@/pages/Calibrate"));
const RemoteCamera = lazy(() => import("@/pages/RemoteCamera"));

const Loading = () => <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Cargando…</div>;

export function App() {
  return (
    <TooltipProvider>
      <Suspense fallback={<Loading />}>
        <Switch>
          {/* full-screen experiences */}
          <Route path="/practicar/:lessonId/:exerciseId" component={Practice} />
          <Route path="/libre" component={Practice} />
          <Route path="/evaluacion" component={Assessment} />
          <Route path="/calibrar" component={Calibrate} />
          <Route path="/camara-remota" component={RemoteCamera} />
          <Route>
            <AppShell>
              <Suspense fallback={<Loading />}>
                <Switch>
                  <Route path="/" component={Home} />
                  <Route path="/lecciones" component={Lessons} />
                  <Route path="/lecciones/:id" component={LessonDetail} />
                  <Route path="/sesion/:id" component={SessionSummary} />
                  <Route path="/afinador" component={Tuner} />
                  <Route path="/progreso" component={Progress} />
                  <Route path="/ajustes" component={SettingsPage} />
                  <Route>
                    <div className="py-20 text-center text-muted-foreground">Página no encontrada</div>
                  </Route>
                </Switch>
              </Suspense>
            </AppShell>
          </Route>
        </Switch>
      </Suspense>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
