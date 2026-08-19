"""첨부 원본 저장소. 로컬에서는 파일 시스템만 사용한다."""

from __future__ import annotations

import shutil
from pathlib import Path


class LocalAttachmentStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def write(self, key: str, source: Path) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def _path(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        if self.root != candidate and self.root not in candidate.parents:
            raise ValueError("잘못된 첨부 저장 경로입니다.")
        return candidate
