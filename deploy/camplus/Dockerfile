# ARM64 SBSA + Blackwell support; keep NVIDIA's CUDA-enabled torch intact.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:25.09-py3
FROM ${PYTORCH_IMAGE}
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 MODEL_DIR=/models/camplus
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    git cmake ninja-build build-essential libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# Build torchaudio against the container's exact torch ABI on ARM64. A PyPI
# wheel can silently replace NVIDIA torch or miss the GB10 CUDA architecture.
RUN python -c "import torch; print('torch===' + torch.__version__)" > /tmp/torch-constraint.txt \
    && git clone --depth 1 --branch v2.9.0 https://github.com/pytorch/audio.git /tmp/torchaudio \
    && cd /tmp/torchaudio \
    && MAX_JOBS=4 USE_CUDA=0 BUILD_SOX=0 BUILD_KALDI=1 BUILD_FFMPEG=0 \
       python -m pip install --no-build-isolation --no-deps . \
    && rm -rf /tmp/torchaudio
COPY requirements.txt .
# Replace the image-wide pip constraint for application dependencies only;
# preserve its exact torch build so a resolver cannot replace NVIDIA torch.
RUN PIP_CONSTRAINT=/tmp/torch-constraint.txt python -m pip install -r requirements.txt \
    && python -c "import torch, torchaudio, funasr; print(torch.__version__, torchaudio.__version__)"
COPY app.py download_model.py diagnostics.py ./
EXPOSE 8000
CMD ["sh", "-c", "python download_model.py && exec uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log"]
