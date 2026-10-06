FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Platforms inject PORT at runtime; shell form so $PORT is expanded.
# One worker with threads: plans spend their time waiting on ORS, so threads let two run at once without a second
# process eating the free tier's memory. The 60 s timeout covers a slow ORS response (the default 30 s killed it).
CMD ["sh", "-c", "gunicorn backend.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 4 --timeout 60"]
