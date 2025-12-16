# TikTok Order Processor

A minimal web application to process TikTok order Excel files into warehouse shipping lists.

## Features
- **One-click processing**: Upload .xlsx, get the shipping list.
- **Smart Merging**: Automatically merges orders with the same recipient details.
- **Strict Validation**: Filters out instructional rows and invalid data.
- **Japanese Format Support**: Handles Japanese addresses, phone numbers, and full-width characters.

## How to Deploy (GitHub Pages)

This application is built as a static Single Page Application (SPA) using React via ES Modules. It requires no build step (no npm install, no webpack).

### Steps:
1.  **Create a Repository**: Create a new public repository on GitHub (e.g., `tiktok-order-processor`).
2.  **Upload Files**: Upload the following files to the root of the repository:
    *   `index.html`
    *   `index.tsx`
3.  **Enable GitHub Pages**:
    *   Go to repository **Settings**.
    *   Click on **Pages** in the left sidebar.
    *   Under **Build and deployment** > **Source**, select **Deploy from a branch**.
    *   Under **Branch**, select `main` (or `master`) and `/ (root)`.
    *   Click **Save**.
4.  **Visit Site**: Wait a minute for the deployment to finish. Your app will be live at `https://<your-username>.github.io/tiktok-order-processor/`.

## Local Development
To run this locally, you need a local web server because ES modules (import/export) do not work directly from the file system (`file://` protocol).

1.  Install a simple server (e.g., specific VS Code extension "Live Server" or python).
2.  Run `python3 -m http.server` in the directory.
3.  Open `http://localhost:8000`.
