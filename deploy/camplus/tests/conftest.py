# Tests provide explicit service configuration without depending on a developer's .env.
import os

os.environ.setdefault('SIMILARITY_THRESHOLD', '0.30')
