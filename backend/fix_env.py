
import os

env_path = ".env"

try:
    with open(env_path, "rb") as f:
        content = f.read()
    
    print(f"Read {len(content)} bytes.")
    
    # Filter out null bytes
    cleaned = content.replace(b'\x00', b'')
    
    # Decode as UTF-8
    text = cleaned.decode('utf-8')
    print(f"Recovered text start: {repr(text[:20])}")
    
    # Write back
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(text)
        
    print("Successfully recovered and saved as UTF-8")

except Exception as e:
    print(f"Recovery failed: {e}")
