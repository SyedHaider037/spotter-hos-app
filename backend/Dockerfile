FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Platforms inject PORT at runtime; shell form so $PORT is expanded.
CMD ["sh", "-c", "gunicorn backend.wsgi:application --bind 0.0.0.0:${PORT:-8000}"]
