import asyncio

from workers.local_platform_worker.ft_worker.runtime import run_stdio


if __name__ == "__main__":
  asyncio.run(run_stdio())
