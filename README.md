# Busmanagementsoftware

Quick commands to run the **FastAPI backend** and **React frontend** locally.

## Prerequisites

- **Python 3.12+** (recommended)
- **Node.js** + **npm** (or Yarn if you prefer; `package.json` pins Yarn but npm works for `start` / `build`)
- **MongoDB** reachable from your machine (Atlas or local)
- Backend env file: `backend/.env` must define at least:
  - `MONGO_URL`
  - `DB_NAME`
  - `JWT_SECRET`

Example layout is already in `backend/.env` in this repo (adjust values for your environment).

---

## Backend (FastAPI)

From the **repository root** `Busmanagementsoftware/`:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

- API base URL: `http://localhost:8000`
- OpenAPI docs (if enabled): `http://localhost:8000/docs`

`server.py` loads `backend/.env` via `python-dotenv` before starting the app.

---

## Frontend (React / CRACO)

Open a **second** terminal from the repo root:

```powershell
cd frontend
npm install
npm start
```

- Dev server: `http://localhost:3000` (default Create React App port)

The frontend reads `REACT_APP_BACKEND_URL` from `frontend/.env` (default in repo: `http://localhost:8000`). Change it if your API runs on another host or port.

---

## Production-style build (frontend only)

```powershell
cd frontend
npm install
npm run build
```

Serve the `frontend/build` folder with any static host you use in production.

---

## Optional: one-liner paths (from repo root)

**Backend**

```powershell
Set-Location .\backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt; uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

**Frontend**

```powershell
Set-Location .\frontend; npm install; npm start
```

---

## Bash (macOS / Linux)

**Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm start
```
