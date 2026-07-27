package routes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixtureBaseline builds a miniature apps/elitea-ui shaped tree exercising
// every mount mechanism the real baseline uses: RouteDefinitions-keyed
// mounts, JSX attribute mounts, Settings literal children, the :version
// append rule, index routes, catch-alls, and declared-but-unmounted patterns.
func fixtureBaseline(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(rel, content string) {
		t.Helper()
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("src/routes.js", `const RouteDefinitions = {
  Chat: '/chat',
  ApplicationsDetail: '/agents/:tab/:agentId',
  Settings: '/settings',
  SettingsWithTab: '/settings/:tab',
  EditBucket: '/artifacts/edit-bucket',
  AuthCallbackPage: '/auth-callback',
};
export default RouteDefinitions;
`)
	write("src/[fsd]/app/routes/ProtectedRoutes.jsx", `const routes = [
  { path: RouteDefinitions.Chat, element: <ChatWrapper /> },
  { path: RouteDefinitions.ApplicationsDetail, element: <EditApplication /> },
];
return (
  <Routes>
    <Route index element={<IndexRoute />} />
    {routes.map(({ path, element }) => (
      <Route key={path} path={path} element={element}>
        {(path.endsWith('/:agentId') || path.endsWith('/:skillId')) && (
          <Route path=":version" element={<></>} />
        )}
      </Route>
    ))}
    <Route path={RouteDefinitions.Settings} element={<Settings />}>
      <Route index element={<Navigate to="model-configuration" replace />} />
      <Route path="model-configuration" element={<AIConfiguration />} />
      <Route path={'create-personal-token'} element={<CreatePersonalToken />} />
    </Route>
    <Route path="/:projectId/*" element={<ProjectSwitcher />} />
    <Route path="*" element={<Page404 />} />
  </Routes>
);
`)
	write("src/[fsd]/app/routes/router.jsx", `<Route path={RouteDefinitions.AuthCallbackPage} element={<AuthCallbackPage />} />
<Route path="/*" element={<AppLayout />} />
`)
	return dir
}

var fixtureMounted = []string{
	"/", "/agents/:tab/:agentId", "/agents/:tab/:agentId/:version",
	"/auth-callback", "/chat", "/:projectId/*", "*", "/*",
	"/settings", "/settings (index)", "/settings/model-configuration",
	"/settings/create-personal-token",
}

func TestExtractBaseline(t *testing.T) {
	ext, err := ExtractBaseline(fixtureBaseline(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range fixtureMounted {
		if !ext.Mounted[p] {
			t.Errorf("expected mounted pattern %q, mounted set: %v", p, sorted(ext.Mounted))
		}
	}
	if len(ext.Mounted) != len(fixtureMounted) {
		t.Errorf("mounted count = %d, want %d: %v", len(ext.Mounted), len(fixtureMounted), sorted(ext.Mounted))
	}
	for _, p := range []string{"/settings/:tab", "/artifacts/edit-bucket"} {
		if _, ok := ext.DeclaredOnly[p]; !ok {
			t.Errorf("expected declared-only pattern %q, got %v", p, ext.DeclaredOnly)
		}
	}
	if len(ext.DeclaredOnly) != 2 {
		t.Errorf("declared-only count = %d, want 2: %v", len(ext.DeclaredOnly), ext.DeclaredOnly)
	}
}

func fixtureTitles() []string {
	titles := make([]string, 0, len(fixtureMounted)+2)
	for _, p := range fixtureMounted {
		titles = append(titles, "Route `"+p+"` renders something")
	}
	titles = append(titles,
		"Route anomaly `/settings/:tab` — declared but not mounted",
		"Route anomaly `/artifacts/edit-bucket` — declared but not mounted",
	)
	return titles
}

func TestDiffPatterns_GreenOnExactMatch(t *testing.T) {
	ext, err := ExtractBaseline(fixtureBaseline(t))
	if err != nil {
		t.Fatal(err)
	}
	if p := DiffPatterns(ext, fixtureTitles()); len(p) != 0 {
		t.Fatalf("expected clean diff, got %v", p)
	}
}

func TestDiffPatterns_RedGreenMutations(t *testing.T) {
	ext, err := ExtractBaseline(fixtureBaseline(t))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		mutate  func([]string) []string
		wantSub string
	}{
		{"manifest drops a mounted route", func(ts []string) []string {
			var out []string
			for _, t := range ts {
				if !strings.Contains(t, "`/chat`") {
					out = append(out, t)
				}
			}
			return out
		}, "no ROUTE item"},
		{"manifest invents a route", func(ts []string) []string {
			return append(ts, "Route `/made-up` renders nothing")
		}, "baseline does not mount"},
		{"manifest invents an anomaly", func(ts []string) []string {
			return append(ts, "Route anomaly `/chat` — wrong")
		}, "does not declare it as unmounted"},
		{"manifest drops a required anomaly", func(ts []string) []string {
			var out []string
			for _, t := range ts {
				if !strings.Contains(t, "edit-bucket") {
					out = append(out, t)
				}
			}
			return out
		}, "no anomaly item"},
		{"title breaks the convention", func(ts []string) []string {
			return append(ts[:1:1], append([]string{"Pattern /chat handled"}, ts[1:]...)...)
		}, "convention"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// GREEN first
			if p := DiffPatterns(ext, fixtureTitles()); len(p) != 0 {
				t.Fatalf("pristine titles must pass, got %v", p)
			}
			// RED
			problems := DiffPatterns(ext, tc.mutate(fixtureTitles()))
			if len(problems) == 0 {
				t.Fatalf("mutation %q must fail", tc.name)
			}
			found := false
			for _, p := range problems {
				if strings.Contains(p, tc.wantSub) {
					found = true
				}
			}
			if !found {
				t.Fatalf("mutation %q: want problem containing %q, got %v", tc.name, tc.wantSub, problems)
			}
		})
	}
}

func TestDiffNewApp(t *testing.T) {
	ext, err := ExtractBaseline(fixtureBaseline(t))
	if err != nil {
		t.Fatal(err)
	}
	// exact copy passes
	if p := DiffNewApp(ext, sorted(ext.Mounted)); len(p) != 0 {
		t.Fatalf("identical new-app export must pass, got %v", p)
	}
	// missing + extra fail
	newPatterns := append(sorted(ext.Mounted)[1:], "/extra")
	p := DiffNewApp(ext, newPatterns)
	joined := strings.Join(p, "\n")
	if !strings.Contains(joined, "missing baseline route") || !strings.Contains(joined, "which the baseline does not") {
		t.Fatalf("expected both directions of the diff to fail, got %v", p)
	}
}

func TestLoadNewRoutes(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "routes.json")
	if err := os.WriteFile(good, []byte(`["/chat","/settings"]`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := LoadNewRoutes(good)
	if err != nil || len(got) != 2 {
		t.Fatalf("LoadNewRoutes = %v, %v", got, err)
	}
	bad := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(bad, []byte(`{"nope":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadNewRoutes(bad); err == nil {
		t.Fatal("expected error for non-array export")
	}
}
