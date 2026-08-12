"""
WSGI/entry point for Smart Money Pipeline.
Alternative to python -m smart_money_pipeline.main
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

if __name__ == "__main__":
    import uvicorn
    from smart_money_pipeline.main import app
    from smart_money_pipeline.config import get_config

    config = get_config()
    port = int(config.log_level.split(":")[1]) if ":" in config.log_level else 8000

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
