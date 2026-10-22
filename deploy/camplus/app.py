"""Stateless CAM++ API. Each inference worker exclusively owns one AutoModel."""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError
from diagnostics import event

MAX_BODY_BYTES = 450000


@dataclass
class Settings:
    model_workers: int = field(default_factory=lambda: int(os.getenv('MODEL_WORKERS', '2')))
    max_pending: int = field(default_factory=lambda: int(os.getenv('MAX_PENDING', '16')))
    timeout_seconds: float = field(default_factory=lambda: float(os.getenv('REQUEST_TIMEOUT_SECONDS', '10')))
    threshold: float = field(default_factory=lambda: float(os.getenv('SIMILARITY_THRESHOLD', '0.60')))
    model_dir: str = field(default_factory=lambda: os.getenv('MODEL_DIR', '/models/camplus'))
    device: str = field(default_factory=lambda: os.getenv('DEVICE', 'cuda:0'))

    def __post_init__(self):
        if not 1 <= self.model_workers <= 16 or not 0 <= self.max_pending <= 1024:
            raise ValueError('Invalid worker/queue limits')
        if not 0 < self.timeout_seconds <= 120 or not -1 <= self.threshold <= 1:
            raise ValueError('Invalid timeout/threshold')


class AudioRequest(BaseModel):
    pcm_base64: str = Field(min_length=1, max_length=426668)
    sample_rate: Literal[16000] = 16000


class VerifyRequest(AudioRequest):
    reference_embedding: list[float] = Field(min_length=192, max_length=192)


def normalized(values):
    embedding = np.asarray(values, dtype=np.float32).reshape(-1)
    if embedding.size != 192 or not np.isfinite(embedding).all():
        raise ValueError('Expected 192 finite embedding values')
    norm = np.linalg.norm(embedding)
    if not np.isfinite(norm) or norm < 1e-8:
        raise ValueError('Embedding must have nonzero finite norm')
    return embedding / norm


def decode_audio(payload):
    try:
        pcm = base64.b64decode(payload.pcm_base64, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, 'pcm_base64 must be valid base64')
    if len(pcm) % 2 or not 6400 <= len(pcm) <= 320000:
        raise HTTPException(422, 'Expected 200–10000ms mono PCM16 LE at 16000Hz')
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
    if not np.any(samples):
        raise HTTPException(422, 'Silent audio cannot identify a speaker')
    return samples


class CampplusModel:
    def __init__(self, settings):
        import torch
        from funasr import AutoModel
        if settings.device.startswith('cuda') and not torch.cuda.is_available():
            raise RuntimeError('CUDA unavailable; check NVIDIA Container Toolkit / GX10 driver')
        self.torch = torch
        self.model = AutoModel(model=settings.model_dir, device=settings.device,
                               disable_update=True, disable_pbar=True)
        # Catch incompatible CUDA/torchaudio builds before reporting readiness.
        self(np.random.default_rng(0).normal(0, .01, 24000).astype(np.float32))

    def __call__(self, samples):
        with self.torch.inference_mode():
            result = self.model.generate(input=samples, fs=16000, disable_pbar=True)
        return normalized(result[0]['spk_embedding'].detach().cpu().numpy())


class InferencePool:
    def __init__(self, settings, models):
        self.settings = settings
        self.admitted = 0
        self.queue = asyncio.Queue(maxsize=settings.model_workers + settings.max_pending)
        self.tasks = [asyncio.create_task(self.worker(model, index)) for index, model in enumerate(models)]

    async def worker(self, model, worker_id):
        while True:
            item = await self.queue.get()
            if item is None:
                self.queue.task_done()
                return
            samples, future, request_id, queued_at = item
            started = time.perf_counter()
            queue_ms = round((started - queued_at) * 1000, 2)
            try:
                if not future.cancelled():
                    event('inference.start', request_id=request_id, worker=worker_id,
                          queue_ms=queue_ms, duration_ms=samples.size / 16)
                    result = await asyncio.to_thread(model, samples)
                    result = normalized(result)
                    event('inference.done', request_id=request_id, worker=worker_id, queue_ms=queue_ms,
                          inference_ms=round((time.perf_counter() - started) * 1000, 2),
                          discarded=future.cancelled())
                    if not future.done():
                        future.set_result(result)
            except Exception as error:
                event('inference.failed', level=logging.ERROR, request_id=request_id,
                      worker=worker_id, error_type=type(error).__name__)
                if not future.done():
                    future.set_exception(HTTPException(503, 'Speaker inference unavailable'))
            finally:
                self.admitted -= 1
                self.queue.task_done()

    async def infer(self, samples, request_id):
        if self.admitted >= self.settings.model_workers + self.settings.max_pending:
            event('inference.overloaded', level=logging.WARNING, request_id=request_id, admitted=self.admitted)
            raise HTTPException(503, 'Inference queue full', headers={'Retry-After': '1'})
        future = asyncio.get_running_loop().create_future()
        self.admitted += 1
        self.queue.put_nowait((samples, future, request_id, time.perf_counter()))
        event('inference.queued', request_id=request_id, admitted=self.admitted)
        try:
            return await asyncio.wait_for(asyncio.shield(future), self.settings.timeout_seconds)
        except asyncio.TimeoutError:
            future.cancel()
            event('inference.timeout', level=logging.WARNING, request_id=request_id,
                  timeout_seconds=self.settings.timeout_seconds)
            raise HTTPException(504, 'Speaker inference timed out')
        except asyncio.CancelledError:
            future.cancel()
            event('inference.cancelled', level=logging.WARNING, request_id=request_id)
            raise
        # The worker owns the capacity slot even after the client disconnects.

    async def close(self):
        await self.queue.join()
        for _ in self.tasks:
            await self.queue.put(None)
        await asyncio.gather(*self.tasks)


async def parse_request(request, schema):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise HTTPException(413, 'Audio request too large')
        chunks.append(chunk)
    try:
        return schema.model_validate_json(b''.join(chunks))
    except ValidationError:
        # Never echo PCM or biometric vectors in error responses or logs.
        raise HTTPException(422, 'Invalid audio request or reference embedding')


def create_app(settings=None, model_factory=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        factory = model_factory or (lambda: CampplusModel(settings))
        event('service.starting', device=settings.device, workers=settings.model_workers,
              max_pending=settings.max_pending, threshold=settings.threshold, model_dir=settings.model_dir)
        models = []
        for index in range(settings.model_workers):
            started = time.perf_counter()
            try:
                models.append(await asyncio.to_thread(factory))
            except Exception as error:
                event('model.failed', level=logging.ERROR, worker=index, error_type=type(error).__name__)
                raise
            event('model.ready', worker=index, elapsed_ms=round((time.perf_counter() - started) * 1000, 2))
        pool = InferencePool(settings, models)
        app.state.pool = pool
        event('service.ready', workers=settings.model_workers)
        try:
            yield
        finally:
            await pool.close()
            event('service.stopped')

    app = FastAPI(title='CAM++ Speaker API', lifespan=lifespan)

    @app.middleware('http')
    async def request_logs(request, call_next):
        supplied = request.headers.get('X-Request-ID', '')
        request_id = supplied if re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', supplied) else str(uuid.uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        path = request.url.path if request.url.path in ('/healthz', '/v1/embedding', '/v1/verify') else 'other'
        try:
            response = await call_next(request)
        except Exception as error:
            event('http.failed', level=logging.ERROR, request_id=request_id, path=path,
                  error_type=type(error).__name__, elapsed_ms=round((time.perf_counter() - started) * 1000, 2))
            raise
        response.headers['X-Request-ID'] = request_id
        event('http.complete', level=logging.DEBUG if path == '/healthz' else
              logging.WARNING if response.status_code >= 400 else logging.INFO,
              request_id=request_id, path=path, status=response.status_code,
              elapsed_ms=round((time.perf_counter() - started) * 1000, 2))
        return response
    origins = [origin.strip() for origin in os.getenv('CORS_ORIGINS', '').split(',') if origin.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['POST', 'GET'],
                           allow_headers=['Content-Type', 'X-Request-ID'], expose_headers=['X-Request-ID'])

    @app.get('/healthz')
    async def health():
        return {'ready': True, 'model': 'CAM++', 'workers': settings.model_workers,
                'pending_and_running': app.state.pool.admitted}

    @app.post('/v1/embedding')
    async def embedding(request: Request):
        payload = await parse_request(request, AudioRequest)
        samples = decode_audio(payload)
        result = await app.state.pool.infer(samples, request.state.request_id)
        event('speaker.embedding', request_id=request.state.request_id, duration_ms=samples.size / 16, dimension=192)
        return {'embedding': result.tolist(), 'dimension': 192, 'duration_ms': samples.size / 16}

    @app.post('/v1/verify')
    async def verify(request: Request):
        payload = await parse_request(request, VerifyRequest)
        samples = decode_audio(payload)
        try:
            reference = normalized(payload.reference_embedding)
        except ValueError as error:
            raise HTTPException(422, str(error))
        result = await app.state.pool.infer(samples, request.state.request_id)
        score = float(np.clip(np.dot(result, reference), -1, 1))
        event('speaker.verify', request_id=request.state.request_id, duration_ms=samples.size / 16,
              score=score, threshold=settings.threshold, matched=score >= settings.threshold)
        return {'matched': score >= settings.threshold, 'score': score, 'threshold': settings.threshold,
                'embedding': result.tolist(), 'duration_ms': samples.size / 16}

    return app


app = create_app()
