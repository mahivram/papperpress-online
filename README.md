# papperpress-online

This repository separates the server-backed version into two deployable parts:

- `frontend/`: static website; deploy it to Vercel.
- `backend/`: Express API and Ghostscript; deploy it to Render.

The browser-only version is in the separate `papperpress` repository and deploys to Vercel without a backend.

## Deploy the backend to Render

Create a Render Blueprint from the repository root using `render.yaml`. It builds `backend/Dockerfile` with `backend/` as the Docker context and uses `/health` for health checks. The Docker image installs Ghostscript and starts the Express API.

## Deploy the frontend to Vercel

Create a Vercel project from this repository and set its Root Directory to `frontend`. Set `VITE_API_BASE_URL` to the Render service's HTTPS origin (for example, `https://pdf-compressor-api.onrender.com`) and deploy.

After the Vercel deployment, set `ALLOWED_ORIGINS` in the Render service to the exact Vercel origin (for example, `https://your-site.vercel.app`, with no path or trailing slash), then redeploy the backend. The backend exposes only that configured origin to browser requests.

## Local backend

Install Node.js 20+ and Ghostscript. On Windows, Ghostscript can be installed with Chocolatey; set `GS_PATH` if it is not found automatically. Then:

```sh
cd backend
npm ci
npm start
```

Set `ALLOWED_ORIGINS` to the local frontend origin when testing browser requests. The API accepts PDFs up to 100 MB, validates the PDF header, limits concurrent and queued jobs, and deletes temporary files after a response or error.
