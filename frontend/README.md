# PaperPress online frontend

This static site uploads PDFs to the separate Ghostscript backend.

## Deploy to Vercel

Create a Vercel project from the `papperpress-online` repository and set its Root Directory to `frontend`. Set `VITE_API_BASE_URL` to the Render backend's HTTPS origin, with no path or trailing slash, then deploy. The build writes this value to `dist/api-config.js`; it is not embedded in source files.

After the Vercel deployment, set `ALLOWED_ORIGINS` in the Render backend to the exact production Vercel origin (for example, `https://your-site.vercel.app`) and redeploy the backend.

Vercel runs `npm run build` and publishes `dist/` as configured in `vercel.json`.
