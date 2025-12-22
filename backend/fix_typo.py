
path = ".env"
try:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    if "OPENAI_API-KEY" in content:
        print("Found typo. Fixing...")
        fixed = content.replace("OPENAI_API-KEY", "OPENAI_API_KEY")
        with open(path, "w", encoding="utf-8") as f:
            f.write(fixed)
        print("Fixed.")
    else:
        print("Typo not found (or already fixed).")
        
except Exception as e:
    print(f"Error: {e}")
