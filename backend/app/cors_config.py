# cors_config.py
from fastapi.middleware.cors import CORSMiddleware
import os

def add_cors_middleware(app):
    # Get allowed origins from environment variable or use defaults
    allowed_origins_str = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001"
    )
    # Split by comma and strip whitespace
    allowed_origins = [origin.strip() for origin in allowed_origins_str.split(",")]
    
    # In production, you might want to allow all origins or specific domains
    # For development, use specific origins. For production, consider:
    # - Specific domain: "https://yourdomain.com,https://www.yourdomain.com"
    # - Or use allow_origin_regex for pattern matching
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )
