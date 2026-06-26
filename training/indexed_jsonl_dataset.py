from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Iterable

import numpy as np


def _parse_simple_yaml_dataset_config(text: str) -> list[dict]:
    datasets = []
    current = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line == "datasets:":
            continue
        if line.startswith("- "):
            if current:
                datasets.append(current)
            current = {}
            line = line[2:].strip()
        if ":" in line and current is not None:
            key, value = line.split(":", 1)
            current[key.strip()] = value.strip().strip("'\"")
    if current:
        datasets.append(current)
    return datasets


def _load_dataset_config(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        config = json.loads(text)
        return config.get("datasets", [])
    return _parse_simple_yaml_dataset_config(text)


def iter_configured_dataset_specs(path: Path) -> Iterable[tuple[Path, float]]:
    if path.suffix.lower() not in {".json", ".yaml", ".yml"}:
        yield path, 1.0
        return
    for entry in _load_dataset_config(path):
        dataset_path = Path(entry["path"])
        if not dataset_path.is_absolute():
            dataset_path = path.parent / dataset_path
        yield dataset_path, float(entry.get("weight", 1.0))


def _index_cache_paths(path: Path, cache_dir: Path | None) -> tuple[Path, Path]:
    if cache_dir is None:
        return path.with_suffix(path.suffix + ".idx.npy"), path.with_suffix(path.suffix + ".idx.json")
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:16]
    stem = f"{path.name}.{digest}"
    return cache_dir / f"{stem}.idx.npy", cache_dir / f"{stem}.idx.json"


def _metadata_for(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": str(path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def _load_offsets(path: Path, cache_dir: Path | None, rebuild: bool) -> np.ndarray:
    index_path, meta_path = _index_cache_paths(path, cache_dir)
    expected_meta = _metadata_for(path)
    if not rebuild and index_path.exists() and meta_path.exists():
        try:
            actual_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if actual_meta == expected_meta:
                return np.load(index_path, mmap_mode="r")
        except (OSError, ValueError, json.JSONDecodeError):
            pass

    offsets: list[int] = []
    with path.open("rb") as handle:
        while True:
            offset = handle.tell()
            line = handle.readline()
            if not line:
                break
            if line.strip():
                offsets.append(offset)
    array = np.asarray(offsets, dtype=np.int64)
    np.save(index_path, array)
    meta_path.write_text(json.dumps(expected_meta, indent=2) + "\n", encoding="utf-8")
    return np.load(index_path, mmap_mode="r")


class JsonlShard:
    def __init__(self, path: Path, weight: float, cache_dir: Path | None, rebuild_index: bool):
        self.path = path
        self.weight = max(0.0, float(weight))
        self.offsets = _load_offsets(path, cache_dir, rebuild_index)
        self._handle = None

    def __len__(self) -> int:
        return int(len(self.offsets))

    def __getstate__(self):
        state = self.__dict__.copy()
        state["_handle"] = None
        return state

    def _file(self):
        if self._handle is None:
            self._handle = self.path.open("rb")
        return self._handle

    def read(self, local_index: int) -> tuple[dict, float]:
        handle = self._file()
        handle.seek(int(self.offsets[local_index]))
        sample = json.loads(handle.readline().decode("utf-8"))
        return sample, self.weight

    def close(self) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None

    def __del__(self):
        self.close()


class IndexedJsonlDataset:
    def __init__(
        self,
        path: Path,
        *,
        max_samples: int = 0,
        seed: int = 7,
        cache_dir: Path | None = None,
        rebuild_index: bool = False,
    ):
        self.shards = [
            JsonlShard(dataset_path, weight, cache_dir, rebuild_index)
            for dataset_path, weight in iter_configured_dataset_specs(path)
        ]
        self.cumulative: list[int] = []
        total = 0
        for shard in self.shards:
            total += len(shard)
            self.cumulative.append(total)
        if total == 0:
            self.indices: list[int] | None = []
        elif max_samples and max_samples > 0 and max_samples < total:
            rng = random.Random(seed)
            self.indices = sorted(rng.sample(range(total), max_samples))
        else:
            self.indices = None

    def __len__(self) -> int:
        if self.indices is not None:
            return len(self.indices)
        return self.cumulative[-1] if self.cumulative else 0

    def _resolve_global_index(self, index: int) -> tuple[JsonlShard, int]:
        if self.indices is not None:
            index = self.indices[index]
        shard_index = int(np.searchsorted(self.cumulative, index + 1, side="left"))
        previous = 0 if shard_index == 0 else self.cumulative[shard_index - 1]
        return self.shards[shard_index], index - previous

    def __getitem__(self, index: int) -> tuple[dict, float]:
        shard, local_index = self._resolve_global_index(index)
        return shard.read(local_index)

    def close(self) -> None:
        for shard in self.shards:
            shard.close()

    def __del__(self):
        self.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
