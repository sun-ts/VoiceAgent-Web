"""One-time model snapshot download to the bind mount, before starting workers."""
import fcntl
import os
from pathlib import Path
import logging
import time
from diagnostics import event

REQUIRED_FILES = ('configuration.json', 'config.yaml', 'campplus_cn_common.bin')


def validate_snapshot(target):
    for filename in REQUIRED_FILES:
        if not (target / filename).is_file():
            raise RuntimeError(f'Model snapshot missing {filename}')


def main():
    from modelscope import snapshot_download
    target = Path(os.getenv('MODEL_DIR', '/models/camplus'))
    target.mkdir(parents=True, exist_ok=True)
    with (target / '.download.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (target / '.download-complete').exists() and all((target / file).is_file() for file in REQUIRED_FILES):
            event('model.cache_hit', model_dir=str(target))
            return
        revision = os.getenv('MODEL_REVISION', 'v2.0.2')
        started = time.perf_counter()
        event('model.download_start', model_dir=str(target), revision=revision)
        try:
            snapshot_download('iic/speech_campplus_sv_zh-cn_16k-common', revision=revision, local_dir=str(target))
            validate_snapshot(target)
        except Exception as error:
            event('model.download_failed', level=logging.ERROR, error_type=type(error).__name__)
            raise
        (target / '.download-complete').touch()
        event('model.download_done', elapsed_ms=round((time.perf_counter() - started) * 1000, 2))


if __name__ == '__main__':
    main()
