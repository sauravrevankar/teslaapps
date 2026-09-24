# TesBids site (prototype)

Static site, no build step. Serve this folder as the web root.

- `index.html` — the whole page (inline CSS/JS; fonts from Google Fonts, 3D viewer from jsDelivr).
- `assets/` — AI-generated renders (Higgsfield), hero video, and the 3D model as embedded glTF JSON.

Local preview: `npx serve tesbids` or `python3 -m http.server -d tesbids`.

Deploy: point any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages) at this folder
as the root directory, then add `tesbids.com` as a custom domain.

All listings, bids and reports on the page are sample data, and every car image, the video and the
3D model are AI-generated. Replace them with real listings and seller photos before launch.
