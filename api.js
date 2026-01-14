// Shared API utilities for interrogation tool

// Extract conversation ID from URL path or query params
const pathMatch = window.location.pathname.match(/^\/v\d*\/(.+)$/) || window.location.pathname.match(/^\/conversation\/(.+)$/);
const urlParams = new URLSearchParams(window.location.search);
export const conversationId = pathMatch?.[1] || urlParams.get('c') || null;

// API base URL (null if no conversation selected)
export const API_BASE = conversationId ? `/api/conversation/${conversationId}` : null;

// List all conversations
export async function listConversations() {
  const res = await fetch('/api/conversations');
  return await res.json();
}

// Emoji markers
export const MARKERS = {
  '\\idea': '💡', '\\done': '✅', '\\later': '⏰', '\\no': '❌',
  '\\yes': '✅', '\\maybe': '🤔', '\\important': '⚠️',
  '\\question': '❓', '\\love': '❤️', '\\star': '⭐',
};

// Load conversation data
export async function loadData() {
  const res = await fetch(`${API_BASE}/data`);
  return await res.json();
}

// Save conversation data
export async function saveData(data) {
  await fetch(`${API_BASE}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// Apply marker shortcut to text
export function applyMarker(text, onMarker) {
  for (const [shortcut, emoji] of Object.entries(MARKERS)) {
    if (text.includes(shortcut)) {
      onMarker(emoji);
      return text.replace(shortcut, '').trim();
    }
  }
  return null;
}
