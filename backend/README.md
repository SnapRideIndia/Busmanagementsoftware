# Electric Bus Management System - Backend API

A FastAPI-based backend application for managing bus operations, incidents, infractions, and related business processes for TGSRTC.

## Features

- **User Management** — Role-based access control (admin, management, depot, vendor)
- **Incident Management** — Track and manage incidents with evidence and infractions
- **API Authentication** — JWT-based security with password hashing
- **MongoDB Integration** — Persistent data storage
- **RESTful API** — Well-structured endpoints with FastAPI

## Prerequisites

- Python 3.8+
- MongoDB (Atlas or local instance)
- pip or poetry for dependency management

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd backend
```

2. Create and activate a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

5. Run the server:

```bash
uvicorn server:app --reload
```

The API will be available at `http://localhost:8000`

## API Documentation

Once the server is running, visit:

- **Interactive API docs**: `http://localhost:8000/docs`
- **Alternative API docs**: `http://localhost:8000/redoc`

## Project Structure

```
backend/
├── app/
│   ├── api/           # API endpoints and dependencies
│   ├── core/          # Core utilities (config, security, database)
│   ├── domain/        # Data models and domain logic
│   ├── schemas/       # Pydantic request/response schemas
│   ├── services/      # Business logic services
│   └── main.py        # FastAPI app initialization
├── scripts/           # Utility scripts (migrations, seeders)
├── requirements.txt   # Python dependencies
├── server.py          # Uvicorn entry point
├── .env.example       # Environment variable template
└── README.md          # This file
```

## Environment Variables

See `.env.example` for all required variables. Key variables:

- `MONGO_URL` — MongoDB connection string (includes credentials)
- `DB_NAME` — Database name
- `JWT_SECRET` — Secret key for JWT token generation (use a strong random value in production)
- `FRONTEND_URL` — Primary frontend URL; used for CORS when `CORS_ORIGINS` is unset
- `CORS_ORIGINS` — Optional comma-separated list of allowed browser origins. If unset and `FRONTEND_URL` is localhost or `127.0.0.1`, both `http://localhost:3000` and `http://localhost:3001` are allowed (common Create React App ports). For a deployed API called from a local dev server while `FRONTEND_URL` is a production URL, set `CORS_ORIGINS` to include your production origin and the local dev URLs you use

## Development

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
black .
flake8 .
```

### Database Seeding

```bash
python scripts/extract_seed.py
```

## Deployment

### Environment Setup

1. Ensure MongoDB is accessible and credentials are correct
2. Generate a strong JWT_SECRET (never use the default)
3. Set production Frontend URL
4. Use environment variables from your deployment platform (do NOT commit `.env`)

### Running in Production

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --workers 4
```

Or with Gunicorn:

```bash
gunicorn -w 4 -k uvicorn.workers.UvicornWorker server:app
```

## Security Considerations

- ⚠️ **Never commit `.env` file** — Use `.env.example` as a template
- Change default JWT_SECRET in production
- Use strong MongoDB credentials
- Enable HTTPS in production
- Implement rate limiting for production
- Review CORS settings for production domains

## Troubleshooting

- **MongoDB Connection Error** — Verify MONGO_URL is correct and MongoDB is running
- **JWT Token Issues** — Ensure JWT_SECRET is consistent across deployments
- **CORS Errors** — Check FRONTEND_URL matches your frontend domain

## License

[Specify your license here]

## Support

For issues and questions, contact the development team.
