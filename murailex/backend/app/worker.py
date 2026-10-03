from __future__ import annotations

import logging

from .jobs import worker_loop

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    worker_loop()
