# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a VSCode extension (JavaScript-based) that fetches and displays financial news telegraphs from Cailian Press (CLS) in real-time. The extension runs in VSCode's extension host process and scrapes the cls.cn/telegraph page using axios and cheerio.

## Development Commands

- **Install dependencies**: `npm install`
- **Run extension in development**: Press F5 in VSCode (launches Extension Development Host)
- **Package extension for distribution**: `vsce package`

## Project Structure

```
cls/
├── extension.js          # Main extension entry point
├── package.json          # Extension manifest and configuration
├── resources/            # Extension icons (icon.png, telegraph.svg)
└── node_modules/         # Dependencies
```

## Architecture

### Core Components

1. **extension.js** - Single-file extension containing:
   - `activate()` - Extension entry point
   - `deactivate()` - Extension cleanup
   - `TelegraphDataProvider` - Tree data provider for sidebar view
   - `fetchTelegraphData()` - Web scraping function

2. **Global State Variables** (managed in extension.js):
   - `telegraphData` - Array of telegraph objects `{id, content, isNew}`
   - `notifiedTelegraphIds` - Set of IDs for already-notified telegraphs
   - `autoRefreshTimer` - setInterval reference for auto-refresh
   - `openedDocumentUris` - Set tracking opened markdown URIs to prevent save prompts

### Data Flow

1. Web Scraping: `fetchTelegraphData()` uses axios to fetch HTML from cls.cn/telegraph, then cheerio to parse `.telegraph-content-box` elements
2. Telegraph IDs are generated via hash function on content (djb2 algorithm variant)
3. New telegraphs are detected by comparing content hashes against existing `telegraphData`
4. Sidebar view is updated via `TelegraphDataProvider.refresh()` which fires `_onDidChangeTreeData` event

### VSCode API Integration

- **Tree View**: Registered as `clsTelegraphList` in custom activity bar container `cls-telegraph-container`
- **Commands**:
  - `cls-telegraph.fetchTelegraph` - Manual fetch
  - `cls-telegraph.viewTelegraph` - View single telegraph detail
  - `cls-telegraph.viewAllTelegraphs` - View all telegraphs combined
  - `cls-telegraph.clearNotifications` - Clear all "new" markers
- **Configuration**: All settings under `clsTelegraph` prefix (see package.json for schema)
- **Virtual Documents**: Telegraph details open as `untitled:` URIs to avoid save prompts

## Configuration Schema

Key settings (via VSCode settings UI or `settings.json`):

- `clsTelegraph.autoRefreshInterval` (number, default 10, min 5, max 300) - Seconds between auto-refresh
- `clsTelegraph.enableAutoRefresh` (boolean, default false) - Toggle auto-refresh
- `clsTelegraph.enableNotifications` (boolean, default true) - Show new telegraph notifications
- `clsTelegraph.maxTelegraphCount` (number, default 50) - Maximum telegraphs to store
- `clsTelegraph.sources` (array) - Configurable news sources (currently only CLS implemented)

## Implementation Notes

- The extension uses JavaScript (not TypeScript) - the compiled `extension.js` is the source file
- Web scraping target: `https://www.cls.cn/telegraph` with CSS selector `.telegraph-content-box`
- Auto-refresh timer is managed via `setupAutoRefresh()` which clears existing timer before creating new one
- Configuration changes trigger `onDidChangeConfiguration` which re-runs `setupAutoRefresh()`
- When viewing telegraph details, the URI format is `untitled:cls-telegraph-{id}.md` for single telegraphs or `untitled:cls-telegraph-all.md` for all telegraphs
