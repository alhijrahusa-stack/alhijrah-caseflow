FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-dejavu-core curl bzip2 unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt requirements-local.txt ./
RUN pip install -r requirements.txt -r requirements-local.txt
# On-device diarization + translation models, pinned by SHA-256 (same artefacts as the local
# launcher). ASR checkpoints are pulled by the worker at the pinned Hugging Face revisions.
ARG REL=https://github.com/k2-fsa/sherpa-onnx/releases/download
RUN set -eux; d=/opt/murailex/models/diar; mkdir -p $d; cd $d; \
    curl -fsSL -o seg.tar.bz2 $REL/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2; \
    echo "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488  seg.tar.bz2" | sha256sum -c -; \
    tar xjf seg.tar.bz2 && rm seg.tar.bz2; \
    curl -fsSL -o wespeaker_en_voxceleb_resnet34_LM.onnx $REL/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx; \
    echo "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012  wespeaker_en_voxceleb_resnet34_LM.onnx" | sha256sum -c -
RUN set -eux; m=/opt/murailex/models/mt; mkdir -p $m/src; \
    for spec in "ar-en https://object.pouta.csc.fi/OPUS-MT-models/ar-en/opus-2019-12-18.zip 2406c939b175616789999f370a3f487e90cd018e4590e8679cf91ee8caff2416" \
                "en-ar https://object.pouta.csc.fi/Tatoeba-MT-models/eng-ara/opus-2021-02-23.zip 857a0d6383f4cb4b990a4915f3a21cb9ab9d00d8837d99ed73bd9f8a5df3af7a"; do \
      set -- $spec; curl -fsSL -o $m/src/$1.zip $2; echo "$3  $m/src/$1.zip" | sha256sum -c -; \
      mkdir -p $m/src/$1 && unzip -q $m/src/$1.zip -d $m/src/$1; \
      ct2-opus-mt-converter --model_dir $m/src/$1 --output_dir $m/$1 --quantization int8; \
      cp $m/src/$1/source.spm $m/src/$1/target.spm $m/src/$1/LICENSE $m/src/$1/README.md $m/$1/; \
    done; rm -rf $m/src
ENV LOCAL_DIAR_DIR=/opt/murailex/models/diar LOCAL_MT_DIR=/opt/murailex/models/mt
# Self-hosted engine route (no cloud transcription). Engine identity is pinned; routing stays
# gated by the committed held-out benchmark runs (app/benchmarks) bound to the same engine
# fingerprints, and by a real self-test of each route at worker start.
ENV ASR_ROUTE=self_hosted \
    LOCAL_ASR_MODEL_REVISION=edaa852ec7e145841d8ffdb056a99866b5f0a478 \
    LOCAL_VERIFY_MODEL_REVISION=08e178d48790749d25932bbc082711ddcfdfbc4f \
    BENCHMARK_ROUTING_APPROVED=true \
    BENCHMARK_DATASET_VERSION=fleurs-ar_eg-test,ami-test-only_words \
    BENCHMARK_HELD_OUT_RUN_ID=92a0a558-2133-50d3-8ec9-8be5277ec214,4252f189-5565-5b4d-8592-91ce7cd44d11,a88ae6c9-729f-5f11-9360-5de0488feb44
COPY alembic.ini pyproject.toml ./
COPY alembic ./alembic
COPY app ./app
RUN useradd --system --uid 10001 murailex && mkdir -p /tmp/murailex-work/hf && chown -R murailex /tmp/murailex-work
USER murailex
ENV MURAILEX_WORK_DIR=/tmp/murailex-work HF_HOME=/tmp/murailex-work/hf
EXPOSE 8000
# API: migrate then serve. The worker uses: python -m app.worker
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
