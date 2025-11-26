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
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )
