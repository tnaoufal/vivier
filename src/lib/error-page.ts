/**
 * The page the server answers with when the app itself could not render
 * (a thrown middleware, a swallowed SSR error): plain HTML with its own
 * styles and no script but the reload, one title line per language
 * (French first), the two actions, and the dark theme as the mirror.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Cette page n'a pas pu se charger · This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #0a0a0a; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #6f6f6f; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 999px; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #0a0a0a; color: #fff; }
      .secondary { background: #fff; color: #0a0a0a; border-color: #d4d4d4; }
      @media (prefers-color-scheme: dark) {
        body { background: #0a0a0a; color: #fafafa; }
        p { color: #a3a3a3; }
        .primary { background: #fafafa; color: #0a0a0a; }
        .secondary { background: #0a0a0a; color: #fafafa; border-color: #333333; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 lang="fr">Cette page n'a pas pu se charger</h1>
      <p lang="en">This page didn't load</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()"><span lang="fr">Réessayer</span> / <span lang="en">Retry</span></button>
        <a class="secondary" href="/"><span lang="fr">Accueil</span> / <span lang="en">Home</span></a>
      </div>
    </div>
  </body>
</html>`;
}
