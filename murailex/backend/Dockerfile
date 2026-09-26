FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY alembic.ini pyproject.toml ./
COPY alembic ./alembic
COPY app ./app
RUN useradd --system --uid 10001 murailex && mkdir -p /tmp/murailex-work && chown murailex /tmp/murailex-work
USER murailex
ENV MURAILEX_WORK_DIR=/tmp/murailex-work
EXPOSE 8000
# API: migrate then serve. The worker uses: python -m app.worker
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
