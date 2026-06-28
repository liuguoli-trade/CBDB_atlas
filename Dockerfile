FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY cbdb_atlas ./cbdb_atlas
COPY config ./config
COPY queries ./queries
COPY scripts ./scripts
COPY web ./web
COPY run.py ./

RUN pip install --no-cache-dir -e .

ENV CBDB_ATLAS_HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1

EXPOSE 8770

CMD ["python", "run.py", "--no-browser"]
