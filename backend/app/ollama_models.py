"""
Resolve which Ollama model to use from env or by listing models available on this machine.
Uses only local Ollama (no Groq/OpenAI), so the app works with whatever you have pulled.
"""
import os
import urllib.request
import json

_OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_PREFERRED = ["gemma3:1b", "gemma3:2b", "gemma2:2b", "llama3.2:1b", "llama3.2:3b", "llama2:latest"]


def get_available_ollama_model() -> str:
    """Return model name: from OLLAMA_MODEL env, or first preferred that exists, or first available."""
    env_model = os.getenv("OLLAMA_MODEL", "").strip()
    if env_model:
        return env_model
    try:
        req = urllib.request.Request(f"{_OLLAMA_BASE_URL.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return "gemma3:1b"
    models = data.get("models") or []
    names = [m.get("name", "").strip() for m in models if m.get("name")]
    if not names:
        return "gemma3:1b"
    for preferred in _PREFERRED:
        for n in names:
            if n == preferred or n.startswith(preferred.split(":")[0] + ":"):
                return n
    return names[0]
