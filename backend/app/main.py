from fastapi import FastAPI
from dotenv import load_dotenv
import os
from app.lesson_01_blocking import router as lesson_01_router
from app.lesson_02_streaming import router as lesson_02_router
from app.lesson_03_async_mcp import router as lesson_03_router
from app.lesson_04_custom import router as lesson_04_router
from app.lesson_05_data_analysis import router as lesson_05_router
from app.cors_config import add_cors_middleware

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Health check endpoint
@app.get("/")
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Backend is running"}

add_cors_middleware(app)

# Register lesson routers
app.include_router(lesson_01_router)
app.include_router(lesson_02_router)
app.include_router(lesson_03_router)
app.include_router(lesson_04_router)
app.include_router(lesson_05_router)