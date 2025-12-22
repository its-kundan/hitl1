
import os
from dotenv import load_dotenv

print(f"CWD: {os.getcwd()}")
if os.path.exists(".env"):
    print(".env found.")
    try:
        with open(".env", "r", encoding="utf-8") as f:
            content = f.read()
            print(f"Content length: {len(content)}")
            print("First 20 chars repr:", repr(content[:20]))
            # Check for common issues
            for line in content.splitlines():
                if "OPENAI_API_KEY" in line:
                    print(f"Line with key: {repr(line)}")
    except Exception as e:
        print(f"Error reading file: {e}")
else:
    print(".env NOT found.")

load_dotenv(verbose=True)
key = os.getenv("OPENAI_API_KEY")
print(f"Key loaded via dotenv: {key is not None}")
if key:
    print(f"Key start: {key[:5]}...")
