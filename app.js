import { Chess } from "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const WHITE_VIEW_RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const BLACK_VIEW_RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const HARD_DEPTH = 15;
const AI_THINK_TIMEOUT_MS = 9000;
const STOCKFISH_JS_URL =
  "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.js";
const STOCKFISH_WASM_URL =
  "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.wasm";

const PIECE_GLYPHS = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚",
};

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status-text");
const turnEl = document.getElementById("turn-text");
const youEl = document.getElementById("you-text");
const aiEl = document.getElementById("ai-text");
const moveListEl = document.getElementById("move-list");
const newGameBtn = document.getElementById("new-game-btn");
const playWhiteBtn = document.getElementById("play-white-btn");
const playBlackBtn = document.getElementById("play-black-btn");

const game = new Chess();

let humanColor = "w";
let aiColor = "b";
let selectedSquare = null;
let targetSquares = new Set();
let aiThinking = false;

let engineWorker = null;
let engineReadyPromise = null;
let engineReadyHandler = null;
let bestMoveResolver = null;
let bestMoveRejecter = null;

function friendlyColor(colorCode) {
  return colorCode === "w" ? "White" : "Black";
}

function callChessBool(methods) {
  for (const method of methods) {
    if (typeof game[method] === "function") {
      return Boolean(game[method]());
    }
  }
  return false;
}

function isGameOverState() {
  if (typeof game.isGameOver === "function") {
    return game.isGameOver();
  }
  if (typeof game.game_over === "function") {
    return game.game_over();
  }
  return (
    isCheckmateState() ||
    isStalemateState() ||
    isInsufficientMaterialState() ||
    isThreefoldRepetitionState() ||
    callChessBool(["in_draw"])
  );
}

function isCheckmateState() {
  return callChessBool(["isCheckmate", "in_checkmate"]);
}

function isStalemateState() {
  return callChessBool(["isStalemate", "in_stalemate"]);
}

function isInsufficientMaterialState() {
  return callChessBool(["isInsufficientMaterial", "insufficient_material"]);
}

function isThreefoldRepetitionState() {
  return callChessBool(["isThreefoldRepetition", "in_threefold_repetition"]);
}

function isCheckState() {
  return callChessBool(["inCheck", "isCheck", "in_check"]);
}

function getDisplaySquares() {
  const files = humanColor === "w" ? FILES : [...FILES].reverse();
  const ranks = humanColor === "w" ? WHITE_VIEW_RANKS : BLACK_VIEW_RANKS;
  const squares = [];

  for (const rank of ranks) {
    for (const file of files) {
      squares.push(file + rank);
    }
  }

  return squares;
}

function clearSelection() {
  selectedSquare = null;
  targetSquares = new Set();
}

function updateInfoText() {
  turnEl.textContent = friendlyColor(game.turn());
  youEl.textContent = friendlyColor(humanColor);
  aiEl.textContent = `${friendlyColor(aiColor)} (Hard)`;

  if (isGameOverState()) {
    if (isCheckmateState()) {
      const winner = game.turn() === "w" ? "Black" : "White";
      statusEl.textContent = `Checkmate - ${winner} wins`;
      return;
    }

    if (isStalemateState()) {
      statusEl.textContent = "Draw by stalemate";
      return;
    }

    if (isInsufficientMaterialState()) {
      statusEl.textContent = "Draw by insufficient material";
      return;
    }

    if (isThreefoldRepetitionState()) {
      statusEl.textContent = "Draw by threefold repetition";
      return;
    }

    statusEl.textContent = "Draw";
    return;
  }

  if (aiThinking) {
    statusEl.textContent = "AI is thinking...";
    return;
  }

  statusEl.textContent = isCheckState()
    ? `${friendlyColor(game.turn())} to move (in check)`
    : `${friendlyColor(game.turn())} to move`;
}

function updateMoveList() {
  const history = game.history();
  const items = [];

  for (let i = 0; i < history.length; i += 2) {
    const whiteMove = history[i] || "";
    const blackMove = history[i + 1] || "";
    items.push(`${Math.floor(i / 2) + 1}. ${whiteMove} ${blackMove}`.trim());
  }

  moveListEl.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderBoard() {
  const squares = getDisplaySquares();
  const disabledBoard = aiThinking || isGameOverState();
  boardEl.innerHTML = "";

  squares.forEach((square, index) => {
    const piece = game.get(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "square";
    button.dataset.square = square;
    button.disabled = disabledBoard;

    const row = Math.floor(index / 8);
    const col = index % 8;
    const isLight = (row + col) % 2 === 0;
    button.classList.add(isLight ? "light" : "dark");

    if (selectedSquare === square) {
      button.classList.add("selected");
    }

    if (targetSquares.has(square)) {
      button.classList.add("target");
    }

    if (piece) {
      button.textContent = PIECE_GLYPHS[piece.color + piece.type];
      button.title = `${friendlyColor(piece.color)} ${piece.type.toUpperCase()}`;
    }

    button.addEventListener("click", () => onSquareClick(square));
    boardEl.appendChild(button);
  });
}

function render() {
  updateInfoText();
  updateMoveList();
  renderBoard();
}

function isHumanTurn() {
  return game.turn() === humanColor;
}

function setSelection(square) {
  selectedSquare = square;
  const moves = game.moves({ square, verbose: true });
  targetSquares = new Set(moves.map((move) => move.to));
}

function maybePromote(move) {
  if (!move) {
    return null;
  }

  const piece = game.get(move.from);
  const targetRank = move.to[1];
  if (
    piece &&
    piece.type === "p" &&
    ((piece.color === "w" && targetRank === "8") ||
      (piece.color === "b" && targetRank === "1"))
  ) {
    move.promotion = "q";
  }

  return move;
}

function moveFromUci(uci) {
  if (!uci || uci === "(none)" || uci.length < 4) {
    return null;
  }

  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : "q",
  };
}

function fallbackMoveUci() {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const moves = game.moves({ verbose: true });

  if (!moves.length) {
    return null;
  }

  let best = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    let score = 0;
    if (move.captured) {
      score += values[move.captured] * 10;
    }
    if (move.san.includes("+")) {
      score += 2;
    }
    if (move.san.includes("#")) {
      score += 1000;
    }

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return `${best.from}${best.to}${best.promotion || ""}`;
}

function handleEngineLine(line) {
  if (engineReadyHandler) {
    engineReadyHandler(line);
  }

  if (bestMoveResolver && line.startsWith("bestmove")) {
    const bestMove = line.trim().split(/\s+/)[1];
    const resolver = bestMoveResolver;
    bestMoveResolver = null;
    bestMoveRejecter = null;
    resolver(bestMove);
  }
}

function createStockfishWorker() {
  const workerSource = `self.importScripts("${STOCKFISH_JS_URL}");`;
  const blob = new Blob([workerSource], { type: "application/javascript" });
  const workerUrl = `${URL.createObjectURL(blob)}#${encodeURIComponent(
    STOCKFISH_WASM_URL
  )}`;
  return new Worker(workerUrl);
}

async function ensureEngineReady() {
  if (engineReadyPromise) {
    return engineReadyPromise;
  }

  engineReadyPromise = new Promise((resolve, reject) => {
    try {
      engineWorker = createStockfishWorker();
    } catch (error) {
      reject(error);
      return;
    }

    const readyTimeout = setTimeout(() => {
      reject(new Error("Engine initialization timed out"));
    }, 10000);

    engineWorker.onmessage = (event) => {
      const line = typeof event.data === "string" ? event.data : String(event.data || "");
      handleEngineLine(line);
    };

    engineWorker.onerror = (error) => {
      reject(error);
    };

    engineReadyHandler = (line) => {
      if (line === "uciok") {
        engineWorker.postMessage("isready");
      }
      if (line === "readyok") {
        clearTimeout(readyTimeout);
        engineReadyHandler = null;
        resolve();
      }
    };

    engineWorker.postMessage("uci");
  });

  return engineReadyPromise;
}

async function requestAiMove(fen) {
  await ensureEngineReady();

  return new Promise((resolve, reject) => {
    if (!engineWorker) {
      reject(new Error("Engine unavailable"));
      return;
    }

    bestMoveResolver = resolve;
    bestMoveRejecter = reject;
    engineWorker.postMessage(`position fen ${fen}`);
    engineWorker.postMessage(`go depth ${HARD_DEPTH}`);

    const timeout = setTimeout(() => {
      if (bestMoveResolver) {
        engineWorker.postMessage("stop");
      }
    }, AI_THINK_TIMEOUT_MS);

    const hardFailTimeout = setTimeout(() => {
      if (bestMoveRejecter) {
        const rejecter = bestMoveRejecter;
        bestMoveResolver = null;
        bestMoveRejecter = null;
        rejecter(new Error("Engine move timeout"));
      }
    }, AI_THINK_TIMEOUT_MS + 1000);

    const originalResolve = bestMoveResolver;
    bestMoveResolver = (move) => {
      clearTimeout(timeout);
      clearTimeout(hardFailTimeout);
      originalResolve(move);
    };
  });
}

async function makeAiMove() {
  if (aiThinking || isGameOverState() || game.turn() !== aiColor) {
    return;
  }

  aiThinking = true;
  clearSelection();
  render();

  let aiMove = null;
  try {
    const bestMove = await requestAiMove(game.fen());
    aiMove = moveFromUci(bestMove);
  } catch (_error) {
    aiMove = moveFromUci(fallbackMoveUci());
  }

  if (!aiMove) {
    aiThinking = false;
    render();
    return;
  }

  const played = game.move(aiMove);
  if (!played) {
    const fallback = moveFromUci(fallbackMoveUci());
    if (fallback) {
      game.move(fallback);
    }
  }

  aiThinking = false;
  render();
}

async function onSquareClick(square) {
  if (aiThinking || isGameOverState() || !isHumanTurn()) {
    return;
  }

  const piece = game.get(square);

  if (selectedSquare) {
    const candidate = maybePromote({
      from: selectedSquare,
      to: square,
    });

    const played = game.move(candidate);
    if (played) {
      clearSelection();
      render();
      await makeAiMove();
      return;
    }
  }

  if (piece && piece.color === humanColor) {
    setSelection(square);
  } else {
    clearSelection();
  }

  renderBoard();
}

function resetGame(playerColor) {
  game.reset();
  humanColor = playerColor;
  aiColor = playerColor === "w" ? "b" : "w";
  clearSelection();
  aiThinking = false;
  render();

  if (game.turn() === aiColor) {
    makeAiMove();
  }
}

newGameBtn.addEventListener("click", () => resetGame(humanColor));
playWhiteBtn.addEventListener("click", () => resetGame("w"));
playBlackBtn.addEventListener("click", () => resetGame("b"));

render();
