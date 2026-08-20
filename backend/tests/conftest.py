from __future__ import annotations

import os

os.environ.setdefault(
    "API_KEY_ENCRYPTION_KEY",
    "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import Base


@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db_session(db_engine):
    TestSession = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    with TestSession() as session:
        yield session


@pytest.fixture
def client(db_session: Session, db_engine, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db_session

    # AI 답변 생성은 백그라운드 스레드가 맡는다(app.services.ai_response_service).
    # 그 스레드는 요청의 DbSession이 아니라 이 팩토리로 새 세션을 연다 — 테스트
    # 엔진을 물려주지 않으면 실제 운영 DB(app.db.SessionLocal)를 보게 된다.
    from app.services import ai_response_service

    monkeypatch.setattr(
        ai_response_service,
        "session_factory",
        sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False),
    )
    # 기본은 동기 실행 — 실제 스레드 동시성을 검증하는 테스트만 이 값을
    # 되돌려서 쓴다 (ai_response_service.run_jobs_synchronously 참고).
    monkeypatch.setattr(ai_response_service, "run_jobs_synchronously", True)

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
