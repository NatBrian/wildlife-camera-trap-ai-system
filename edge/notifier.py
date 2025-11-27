"""
Notification helpers for new clips (Telegram Bot API or Discord webhook).
"""

import logging
import os
from typing import Dict

import requests


class Notifier:
    def __init__(self, config: Dict) -> None:
        self.enabled = bool(config.get("enabled", False))
        self.provider = config.get("provider", "telegram")
        self.telegram = config.get("telegram", {}) or {}
        self.discord = config.get("discord", {}) or {}

    def send_new_clip_notification(self, clip_metadata: Dict) -> None:
        if not self.enabled:
            return

        try:
            if self.provider == "discord":
                self._send_discord(clip_metadata)
            else:
                self._send_telegram(clip_metadata)
        except Exception as exc:  # noqa: BLE001 - best-effort notify
            logging.warning("Notification failed: %s", exc)

    def _send_telegram(self, clip_metadata: Dict) -> None:
        token = self.telegram.get("bot_token") or os.getenv("TELEGRAM_BOT_TOKEN")
        chat_id = self.telegram.get("chat_id") or os.getenv("TELEGRAM_CHAT_ID")
        if not token or not chat_id:
            logging.debug("Telegram not configured; skipping notification")
            return

        text = self._render_message(clip_metadata)
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        requests.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})

    def _send_discord(self, clip_metadata: Dict) -> None:
        webhook_url = self.discord.get("webhook_url") or os.getenv("DISCORD_WEBHOOK_URL")
        if not webhook_url:
            logging.debug("Discord not configured; skipping notification")
            return
        message = self._render_message(clip_metadata)
        requests.post(webhook_url, json={"content": message})

    @staticmethod
    def _render_message(clip_metadata: Dict) -> str:
        primary = clip_metadata.get("species_counts") or {}
        if primary:
            top_species = max(primary, key=primary.get)
            counts = f"{top_species} x{primary[top_species]}"
        else:
            counts = "unknown species"
        return (
            f"New wildlife clip from {clip_metadata.get('device_id', 'device')}:\n"
            f"{counts}\n"
            f"Start: {clip_metadata.get('start_time_utc')}\n"
            f"End: {clip_metadata.get('end_time_utc')}"
        )
