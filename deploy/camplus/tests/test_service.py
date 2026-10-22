import asyncio
import base64
import json
import logging
import threading
import time

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import Settings, create_app
from download_model import validate_snapshot


def audio(ms=1024, value=1000):
    return {'pcm_base64': base64.b64encode(np.full(ms * 16, value, dtype='<i2').tobytes()).decode(), 'sample_rate': 16000}


def vector(axis=0):
    result = [0.0] * 192
    result[axis] = 1.0
    return result


class Model:
    def __call__(self, samples):
        return vector(0 if samples[0] > 0 else 1)


def test_embedding_and_stateless_comparison():
    with TestClient(create_app(Settings(), Model)) as client:
        result = client.post('/v1/embedding', json=audio(1500))
        assert result.status_code == 200
        assert result.json()['embedding'] == vector()
        assert result.json()['duration_ms'] == 1500
        match = client.post('/v1/verify', json={**audio(), 'reference_embedding': vector()})
        assert match.json()['matched'] is True
        assert match.json()['duration_ms'] == 1024
        assert match.json()['score'] == 1.0
        other = client.post('/v1/verify', json={**audio(value=-1000), 'reference_embedding': vector()})
        assert other.json()['matched'] is False
        # Independent client's reference cannot overwrite a shared enrolled identity.
        assert client.post('/v1/verify', json={**audio(), 'reference_embedding': vector(1)}).json()['matched'] is False


def test_invalid_pcm_and_embedding_are_rejected_before_inference():
    with TestClient(create_app(Settings(), Model)) as client:
        for payload in [audio(100), audio(10001), {**audio(), 'sample_rate': 8000},
                        {**audio(), 'pcm_base64': 'not base64!'},
                        {**audio(), 'pcm_base64': 'AQ=='}, audio(value=0)]:
            assert client.post('/v1/embedding', json=payload).status_code in (413, 422)
        for reference in [[1], [0.0] * 192, ['NaN'] * 192]:
            assert client.post('/v1/verify', json={**audio(), 'reference_embedding': reference}).status_code == 422


def test_bounded_parallel_inference_and_health_during_load():
    lock = threading.Lock()
    active = peak = 0
    release = threading.Event()

    class SlowModel:
        def __call__(self, samples):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            release.wait(5)
            with lock:
                active -= 1
            return vector()

    async def scenario():
        app = create_app(Settings(model_workers=2, max_pending=1), SlowModel)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                tasks = [asyncio.create_task(client.post('/v1/embedding', json=audio())) for _ in range(3)]
                for _ in range(100):
                    if peak == 2:
                        break
                    await asyncio.sleep(.01)
                assert peak == 2
                assert (await client.get('/healthz')).status_code == 200
                assert (await client.post('/v1/embedding', json=audio())).status_code == 503
                release.set()
                assert all(r.status_code == 200 for r in await asyncio.gather(*tasks))
    asyncio.run(scenario())


def test_cancelled_request_does_not_release_a_still_running_model():
    # A timed-out client must not cause the same mutable AutoModel to be reused concurrently.
    release = threading.Event()
    entered = threading.Event()
    class SlowModel:
        def __call__(self, samples):
            entered.set()
            release.wait(5)
            return vector()
    async def scenario():
        app = create_app(Settings(model_workers=1, max_pending=0), SlowModel)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                task = asyncio.create_task(client.post('/v1/embedding', json=audio()))
                while not entered.is_set():
                    await asyncio.sleep(.01)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                assert (await client.post('/v1/embedding', json=audio())).status_code == 503
                release.set()
    asyncio.run(scenario())


def test_snapshot_requires_funasr_config_not_only_old_modelscope_files(tmp_path):
    (tmp_path / 'configuration.json').write_text('{}')
    (tmp_path / 'campplus_cn_common.bin').write_bytes(b'weights')
    with pytest.raises(RuntimeError, match='config.yaml'):
        validate_snapshot(tmp_path)
    (tmp_path / 'config.yaml').write_text('model: CAMPPlus')
    validate_snapshot(tmp_path)


def test_timeout_keeps_capacity_until_inference_finishes():
    release = threading.Event()
    class SlowModel:
        def __call__(self, samples):
            release.wait(5)
            return vector()
    with TestClient(create_app(Settings(model_workers=1, max_pending=0, timeout_seconds=.02), SlowModel)) as client:
        try:
            assert client.post('/v1/embedding', json=audio()).status_code == 504
            assert client.post('/v1/embedding', json=audio()).status_code == 503
        finally:
            release.set()


def test_request_logs_link_verification_and_timings_without_biometric_data(caplog):
    caplog.set_level(logging.INFO, logger='camplus')
    payload = {**audio(), 'reference_embedding': vector()}
    with TestClient(create_app(Settings(), Model)) as client:
        response = client.post('/v1/verify', json=payload, headers={'X-Request-ID': 'trace-window-2'})
        assert response.headers.get('X-Request-ID') == 'trace-window-2'
    events = [json.loads(record.message) for record in caplog.records if record.name == 'camplus']
    trace = [item for item in events if item.get('request_id') == 'trace-window-2']
    assert any(item['event'] == 'inference.done' and item['queue_ms'] >= 0 and item['inference_ms'] >= 0 for item in trace)
    assert any(item['event'] == 'speaker.verify' and item['matched'] is True and item['score'] == 1 for item in trace)
    assert any(item['event'] == 'http.complete' and item['status'] == 200 for item in trace)
    assert payload['pcm_base64'] not in caplog.text
    assert 'reference_embedding' not in caplog.text


def test_validation_and_cors_preflight_are_observable(caplog, monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS', 'https://voice.example')
    caplog.set_level(logging.INFO, logger='camplus')
    with TestClient(create_app(Settings(), Model)) as client:
        response = client.post('/v1/embedding', json=audio(100), headers={'X-Request-ID': 'bad input!'})
        assert response.status_code == 422
        assert response.headers.get('X-Request-ID') not in (None, 'bad input!')
        preflight = client.options('/v1/verify', headers={'Origin': 'https://voice.example',
            'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-request-id'})
        assert preflight.status_code == 200
    events = [json.loads(record.message) for record in caplog.records if record.name == 'camplus']
    assert any(item['event'] == 'http.complete' and item['status'] == 422 for item in events)
