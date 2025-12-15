# Production Deployment Guide

## Fixing "Failed to fetch" Error in Production

This guide explains how to fix the "Failed to fetch" error when deploying to production.

## Issues Fixed

### 1. Hardcoded API URLs
All hardcoded `http://localhost:8000` URLs have been replaced with environment variable-based configuration.

### 2. CORS Configuration
The backend CORS middleware now properly handles production domains.

## Frontend Configuration

### Environment Variables

Create a `.env` file in the `frontend` directory (or set environment variables in your hosting platform):

```env
REACT_APP_API_URL=https://your-backend-api.com
```

**Examples:**
- Vercel: Add in Project Settings → Environment Variables
- Netlify: Add in Site Settings → Environment Variables
- Local: Create `frontend/.env` file

**Important:** 
- Variable name MUST start with `REACT_APP_` for React to access it
- Rebuild the frontend after adding/changing environment variables

### Build Command

```bash
cd frontend
npm run build
```

## Backend Configuration

### CORS Setup

Set the `ALLOWED_ORIGINS` environment variable in your backend hosting platform:

```env
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://www.your-frontend-domain.com
```

**Examples:**
- Railway: Add in Variables tab
- Render: Add in Environment section
- Heroku: `heroku config:set ALLOWED_ORIGINS=https://yourdomain.com`
- Local: Add to `backend/.env`

### Multiple Origins

Separate multiple origins with commas (no spaces around commas):

```env
ALLOWED_ORIGINS=https://app.example.com,https://www.example.com,http://localhost:3000
```

### Default Origins (Development)

If `ALLOWED_ORIGINS` is not set, defaults to:
- `http://localhost:3000`
- `http://localhost:3001`

## Deployment Checklist

### Frontend
- [ ] Set `REACT_APP_API_URL` environment variable
- [ ] Rebuild frontend after setting environment variable
- [ ] Verify API URL is correct (no trailing slash)
- [ ] Test file upload functionality

### Backend
- [ ] Set `ALLOWED_ORIGINS` environment variable
- [ ] Include your frontend domain(s) in `ALLOWED_ORIGINS`
- [ ] Set `OPENAI_API_KEY` environment variable
- [ ] Ensure backend is accessible from frontend domain
- [ ] Check backend logs for CORS errors

## Common Issues

### Issue: "Failed to fetch" in Production

**Causes:**
1. Frontend using hardcoded `localhost:8000` (FIXED)
2. CORS not configured for production domain
3. Backend URL incorrect in environment variable
4. Backend not accessible from frontend domain

**Solutions:**
1. ✅ Set `REACT_APP_API_URL` in frontend
2. ✅ Set `ALLOWED_ORIGINS` in backend
3. ✅ Verify backend URL is correct
4. ✅ Check backend is running and accessible

### Issue: CORS Error

**Error:** `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Solution:**
- Add your frontend domain to `ALLOWED_ORIGINS` in backend
- Ensure protocol matches (https vs http)
- Ensure no trailing slashes in URLs

### Issue: Environment Variable Not Working

**Solution:**
- Variable name must start with `REACT_APP_`
- Rebuild frontend after adding/changing variables
- Restart development server if testing locally
- Clear browser cache

## Platform-Specific Guides

### Vercel (Frontend)

1. Go to Project Settings → Environment Variables
2. Add:
   - Key: `REACT_APP_API_URL`
   - Value: `https://your-backend-api.com`
3. Redeploy

### Railway (Backend)

1. Go to Variables tab
2. Add:
   - `ALLOWED_ORIGINS`: `https://your-frontend.vercel.app`
   - `OPENAI_API_KEY`: `your-key`
3. Deploy

### Render (Backend)

1. Go to Environment section
2. Add:
   - `ALLOWED_ORIGINS`: `https://your-frontend.com`
   - `OPENAI_API_KEY`: `your-key`
3. Deploy

## Testing

### Local Testing with Production URLs

1. **Frontend:**
   ```bash
   cd frontend
   REACT_APP_API_URL=https://your-backend.com npm start
   ```

2. **Backend:**
   ```bash
   cd backend
   ALLOWED_ORIGINS=http://localhost:3000 python -m uvicorn app.main:app --reload
   ```

### Verify Configuration

1. Check browser console for API calls
2. Verify requests go to correct backend URL
3. Check Network tab for CORS headers
4. Test file upload functionality

## Security Notes

- Never commit `.env` files to git
- Use HTTPS in production
- Restrict `ALLOWED_ORIGINS` to specific domains
- Keep API keys secure
- Use environment variables, not hardcoded values

## Files Changed

- `frontend/src/DataAnalysisDemo.js` - Removed hardcoded URLs
- `backend/app/cors_config.py` - Added production CORS support
- `frontend/src/AssistantService.js` - Already using BASE_URL (no changes needed)





