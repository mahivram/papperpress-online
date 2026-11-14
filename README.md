# Server-side PDF compressor

Express accepts PDF uploads (100 MB maximum), validates the PDF header, limits requests, restricts active and queued compression jobs, and invokes Ghostscript without a shell. Temporary input/output files are created in a private OS temp directory and removed after the response or on error. Production deployments should additionally isolate Ghostscript in a restricted container, configure a reverse-proxy request timeout and HTTPS, and review Ghostscript's licensing terms.

## Local setup

Install Node.js 20+ and Ghostscript. On Windows, Chocolatey can install Ghostscript from an Administrator PowerShell:

```powershell
choco install ghostscript --yes
```

On Windows, the server searches the standard `Program Files\gs` install directory automatically. For a nonstandard location, set `GS_PATH` to the full executable path before starting the server. On Linux/macOS, install the `gs` executable and set `GS_PATH` if it is not on `PATH`.

```sh
npm install
npm start
```

Open `http://localhost:3000`. Set `PORT` to change the listening port. The optional target-size workflow tries multiple resolutions and JPEG qualities, then returns its smallest result if the requested target cannot be reached.

## Deploy on Render

Connect the `papperpress-online` repository at its root, then create a Render Blueprint from `render.yaml`. The Dockerfile installs Ghostscript and starts the Express server. The website and `/api/compress` endpoint are served from the same Render service.

Replace the placeholder canonical URLs and sitemap entries in `public/` with the website's production URL before launch.

## Docker

```sh
docker build -t pdf-compressor .
docker run --rm -p 3000:3000 --memory=1g --cpus=2 pdf-compressor
```

Do not expose the container directly to the internet without a TLS reverse proxy, firewalling, request timeouts, and host-level resource limits. Update the placeholder canonical URLs and sitemap entries in `public/` before deployment.
