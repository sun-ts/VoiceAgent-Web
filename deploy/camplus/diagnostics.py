"""Structured metadata logs; never include request bodies/audio/embeddings."""
import json
import logging
import os
from datetime import datetime, timezone

LOG = logging.getLogger('camplus')
LOG.setLevel(getattr(logging, os.getenv('LOG_LEVEL', 'INFO').upper(), logging.INFO))
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    LOG.addHandler(handler)


def event(name, level=logging.INFO, **fields):
    LOG.log(level, json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'event': name,
                              **fields}, ensure_ascii=False, allow_nan=False))
