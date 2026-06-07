# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the React frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Install dependencies first (cache layer)
COPY frontend/package*.json ./
RUN npm ci

# Copy source and build
COPY frontend/ ./
RUN npm run build
# Output is at /build/frontend/dist


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Python backend serving API + compiled frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Container timezone — schedules the lunchtime Overview cron at local Brussels time
ENV TZ=Europe/Brussels

# System deps (tzdata so the TZ above resolves properly)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

# Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend source
COPY backend/ ./backend/

# Compiled frontend from Stage 1
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Runtime data directories (SQLite DB + file uploads live here)
RUN mkdir -p /data/uploads

ENV DB_PATH=/data/department.db
ENV UPLOAD_DIR=/data/uploads
ENV FRONTEND_DIST=/app/frontend/dist
# Hosted/server deployments enforce authentication (the edition flag). The
# Tauri desktop build leaves this unset, so it stays login-free. First run on a
# fresh Docker volume shows the setup page to create the admin account.
ENV EFFRO_AUTH_ENABLED=true

EXPOSE 8000

WORKDIR /app/backend
# Run uvicorn from /app so Python can find the backend package
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
