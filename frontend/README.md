# Bus Management Software - Frontend

A React-based frontend for the Electric Bus Management System (EBMS) for TGSRTC.

## Features

- **User Authentication** — Secure login with role-based access control
- **Responsive Design** — Built with React and Tailwind CSS
- **Interactive Components** — Radix UI component library for modern UI
- **Real-time Data** — API integration with FastAPI backend
- **Maps Integration** — Google Maps support for route tracking
- **Form Handling** — React Hook Form with validation

## Prerequisites

- Node.js 14+
- npm or yarn package manager
- Backend API running (see backend documentation)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your backend URL
```

4. Start the development server:

```bash
npm start
```

The application will open at `http://localhost:3000`

## Available Scripts

### `npm start`

Runs the app in development mode with hot reload.
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

### `npm test`

Launches the test runner in interactive watch mode.

### `npm run build`

Builds the app for production to the `build/` folder.
The build is optimized and minified for deployment.

## Project Structure

```
frontend/
├── src/
│   ├── components/      # Reusable UI components
│   ├── contexts/        # React Context (Auth, etc.)
│   ├── pages/           # Page components
│   ├── lib/             # Utilities, API endpoints
│   ├── App.js           # Main app component
│   └── index.js         # Entry point
├── public/              # Static assets
├── build/               # Production build (generated)
├── package.json         # Dependencies
├── tailwind.config.js   # Tailwind CSS config
└── .env.example         # Environment variables template
```

## Environment Variables

See `.env.example` for required variables:

- `REACT_APP_BACKEND_URL` — Backend API URL (e.g., `http://localhost:8000`)

## Deployment

### Build for Production

```bash
npm run build
```

This creates an optimized production build in the `build/` folder.

### Deploy to a Static Host

The `build/` directory can be deployed to:

- Vercel
- Netlify
- GitHub Pages
- AWS S3 + CloudFront
- Any static hosting service

### Environment Variables in Production

Set `REACT_APP_BACKEND_URL` to your production API URL before building:

```bash
REACT_APP_BACKEND_URL=https://api.yourdomain.com npm run build
```

## Security Considerations

- ⚠️ **Never commit `.env`** — Use `.env.example` as a template
- Ensure backend is running on HTTPS in production
- API credentials should be handled server-side, not client-side
- Validate all user input on both frontend and backend

## Troubleshooting

- **Backend connection error** — Verify `REACT_APP_BACKEND_URL` is correct and backend is running
- **CORS errors** — Backend CORS settings don't match frontend URL
- **Build errors** — Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`

## License

[Specify your license here]

## Support

For issues and questions, contact the development team.
