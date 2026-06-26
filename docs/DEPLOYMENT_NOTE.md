# Deployment Note

- GitHub Pages deployment is branch-based.
- `main` triggers `.github/workflows/deploy.yml`.
- The workflow builds `dist/` and publishes it to the `gh-pages` branch.
- If the site still looks stale after a successful workflow run, do a hard refresh.
