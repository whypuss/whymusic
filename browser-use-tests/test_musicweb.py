#!/usr/bin/env python3
"""browser-use 測試 MusicFree Web - 使用本地代理"""
import os
os.environ["BROWSER_USE_LOGGING_LEVEL"] = "info"
os.environ["ANONYMIZED_TELEMETRY"] = "false"

import asyncio
from browser_use import Agent
from browser_use.llm.litellm import ChatLiteLLM

llm = ChatLiteLLM(
    model="openai/deepseek-flash",
    api_key=os.environ.get("OPENAI_API_KEY", "your-api-key"),
    api_base=os.environ.get("OPENAI_BASE_URL", "http://localhost:8081/v1"),
)

async def main():
    agent = Agent(
        task="Go to http://localhost:8894, take a screenshot, describe the UI layout and what you see on the page. Be concise.",
        llm=llm,
    )
    result = await agent.run(max_steps=10)
    print(f"\nSteps completed: {len(result.history)}")

if __name__ == "__main__":
    asyncio.run(main())
