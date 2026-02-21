# Chess2

A browser chess game with a hard AI opponent.

## Features

- Full legal move handling with [`chess.js`](https://github.com/jhlywa/chess.js).
- Play as White or Black.
- Hard AI level powered by Stockfish 18 lite single-thread (depth 15 search).
- Move list, check/checkmate detection, and draw-state handling.

## Run locally

Use any static server from the repository root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000`

## Deploy on GitHub Pages

This project is static HTML/CSS/JS, so it can be deployed directly with GitHub Pages by publishing the repository root.
