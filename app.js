import { Chess } from "https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const WHITE_VIEW_RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const AI_THINK_TIMEOUT_MS = 9000;
const EXPERT_HINT_DEPTH = 17;
const STOCKFISH_JS_URL =
  "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.js";
const STOCKFISH_WASM_URL =
  "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.wasm";
const LEVELS = Array.from({ length: 15 }, (_, index) => {
  const levelNumber = index + 1;

  if (levelNumber === 1) {
    return {
      id: "level-1",
      label: "Level 1 (Starter)",
      aiMode: "random",
      depth: 1,
      winPoints: 80,
    };
  }

  if (levelNumber === 2) {
    return {
      id: "level-2",
      label: "Level 2 (Easy)",
      aiMode: "heuristic",
      depth: 2,
      winPoints: 120,
    };
  }

  return {
    id: `level-${levelNumber}`,
    label: `Level ${levelNumber}`,
    aiMode: "engine",
    depth: Math.min(2 + levelNumber, 18),
    winPoints: 120 + levelNumber * 40,
  };
});

const PIECE_IMAGES = {
  wp: "./assets/pieces/Chess_plt45.svg",
  wn: "./assets/pieces/Chess_nlt45.svg",
  wb: "./assets/pieces/Chess_blt45.svg",
  wr: "./assets/pieces/Chess_rlt45.svg",
  wq: "./assets/pieces/Chess_qlt45.svg",
  wk: "./assets/pieces/Chess_klt45.svg",
  bp: "./assets/pieces/Chess_pdt45.svg",
  bn: "./assets/pieces/Chess_ndt45.svg",
  bb: "./assets/pieces/Chess_bdt45.svg",
  br: "./assets/pieces/Chess_rdt45.svg",
  bq: "./assets/pieces/Chess_qdt45.svg",
  bk: "./assets/pieces/Chess_kdt45.svg",
};

const PIECE_NAMES = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

const boardEl = document.getElementById("board");
const winnerPingEl = document.getElementById("winner-ping");
const badgeEl = document.getElementById("ai-badge");
const statusEl = document.getElementById("status-text");
const turnEl = document.getElementById("turn-text");
const youEl = document.getElementById("you-text");
const aiEl = document.getElementById("ai-text");
const levelTextEl = document.getElementById("level-text");
const scoreTextEl = document.getElementById("score-text");
const winsTextEl = document.getElementById("wins-text");
const progressTextEl = document.getElementById("progress-text");
const hintTextEl = document.getElementById("hint-text");
const levelPointsTextEl = document.getElementById("level-points-text");
const moveListEl = document.getElementById("move-list");
const newGameBtn = document.getElementById("new-game-btn");
const playWhiteBtn = document.getElementById("play-white-btn");
const playBlackBtn = document.getElementById("play-black-btn");
const educativeToggleEl = document.getElementById("educative-toggle");
const levelSelectEl = document.getElementById("level-select");
const nextLevelBtn = document.getElementById("next-level-btn");

const game = new Chess();

let humanColor = "w";
let aiColor = "b";
let selectedSquare = null;
let targetSquares = new Set();
let aiThinking = false;
let currentLevelIndex = 0;
let unlockedLevelIndex = 0;
let score = 0;
let totalWins = 0;
let gameResultAwarded = false;
let educativeMode = false;
let boardHovering = false;
let preferredMove = null;
let hintRequestFen = null;
let lastOpponentMove = null;
let winnerPingTimeout = null;

let engineWorker = null;
let engineReadyPromise = null;
let engineReadyHandler = null;
let bestMoveResolver = null;
let bestMoveRejecter = null;

let hintWorker = null;
let hintReadyPromise = null;
let hintReadyHandler = null;
let hintBestMoveResolver = null;
let hintBestMoveRejecter = null;

function friendlyColor(colorCode) {
  return colorCode === "w" ? "White" : "Black";
}

function showWinnerPing(colorCode) {
  const winner = friendlyColor(colorCode);
  winnerPingEl.textContent = `${winner} Wins!`;
  winnerPingEl.classList.remove("show");
  // Restart animation cleanly.
  void winnerPingEl.offsetWidth;
  winnerPingEl.classList.add("show");

  if (winnerPingTimeout) {
    clearTimeout(winnerPingTimeout);
  }

  winnerPingTimeout = setTimeout(() => {
    winnerPingEl.classList.remove("show");
  }, 2500);
}

function getCurrentLevel() {
  return LEVELS[currentLevelIndex];
}

function updateLevelSelector() {
  levelSelectEl.innerHTML = "";

  LEVELS.forEach((level, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = level.label;
    levelSelectEl.appendChild(option);
  });

  levelSelectEl.value = String(currentLevelIndex);
}

function addScore(points) {
  score += points;
  scoreTextEl.textContent = String(score);
}

function updateProgressInfo(message = "") {
  const level = getCurrentLevel();
  badgeEl.textContent = `${level.label} AI`;
  levelTextEl.textContent = level.label;
  progressTextEl.textContent = `${unlockedLevelIndex + 1} / ${LEVELS.length}`;
  levelPointsTextEl.textContent = `Win = +${level.winPoints} points${message ? ` - ${message}` : ""}`;
}

function canAdvanceToNextLevel() {
  return currentLevelIndex < LEVELS.length - 1;
}

function updateNextLevelButton() {
  nextLevelBtn.disabled = !canAdvanceToNextLevel();
}

function getKingSquare(color) {
  for (let rank = 1; rank <= 8; rank += 1) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = game.get(square);
      if (piece && piece.type === "k" && piece.color === color) {
        return square;
      }
    }
  }

  return null;
}

function maybeRequestPreferredMove() {
  if (!educativeMode || aiThinking || isGameOverState() || !isHumanTurn()) {
    preferredMove = null;
    hintRequestFen = null;
    return;
  }

  const fen = game.fen();
  if (preferredMove && preferredMove.fen === fen) {
    return;
  }

  if (hintRequestFen === fen) {
    return;
  }

  hintRequestFen = fen;
  requestExpertHintMove(fen)
    .then((uciMove) => {
      if (!educativeMode || aiThinking || !isHumanTurn() || game.fen() !== fen) {
        return;
      }

      const move = moveFromUci(uciMove) || moveFromUci(fallbackMoveUci());
      preferredMove = move ? { ...move, fen } : null;
      updateHintText();
      renderBoard();
    })
    .catch(() => {
      if (!educativeMode || aiThinking || !isHumanTurn() || game.fen() !== fen) {
        return;
      }

      const move = moveFromUci(fallbackMoveUci());
      preferredMove = move ? { ...move, fen } : null;
      updateHintText();
      renderBoard();
    })
    .finally(() => {
      if (hintRequestFen === fen) {
        hintRequestFen = null;
      }
    });
}

function updateHintText() {
  if (!educativeMode) {
    hintTextEl.textContent = "Off";
    return;
  }

  if (isGameOverState()) {
    hintTextEl.textContent = "Game over";
    return;
  }

  if (!isHumanTurn()) {
    hintTextEl.textContent = "Wait for your turn";
    return;
  }

  if (hintRequestFen === game.fen()) {
    hintTextEl.textContent = "Calculating expert hint...";
    return;
  }

  if (!preferredMove) {
    hintTextEl.textContent = "No hint available";
    return;
  }

  hintTextEl.textContent = boardHovering
    ? `Best: ${preferredMove.from} -> ${preferredMove.to}`
    : "Hover board to reveal best move";
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
  const squares = [];

  for (const rank of WHITE_VIEW_RANKS) {
    for (const file of FILES) {
      squares.push(file + rank);
    }
  }

  return squares;
}

function isLightSquare(square) {
  const fileIndex = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (fileIndex + rank) % 2 === 0;
}

function clearSelection() {
  selectedSquare = null;
  targetSquares = new Set();
}

function updateInfoText() {
  const level = getCurrentLevel();
  turnEl.textContent = friendlyColor(game.turn());
  youEl.textContent = friendlyColor(humanColor);
  aiEl.textContent = `${friendlyColor(aiColor)} (${level.label})`;
  statusEl.classList.remove("status-check");

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

  const inCheck = isCheckState();
  statusEl.classList.toggle("status-check", inCheck);
  statusEl.textContent = inCheck
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

function maybeHandleGameEndRewards() {
  if (!isGameOverState() || gameResultAwarded || !isCheckmateState()) {
    return;
  }

  gameResultAwarded = true;
  const winnerColor = game.turn() === "w" ? "b" : "w";
  showWinnerPing(winnerColor);

  if (winnerColor !== humanColor) {
    updateProgressInfo("No points this round");
    updateNextLevelButton();
    return;
  }

  const level = getCurrentLevel();
  totalWins += 1;
  winsTextEl.textContent = String(totalWins);
  addScore(level.winPoints);

  if (currentLevelIndex >= unlockedLevelIndex && unlockedLevelIndex < LEVELS.length - 1) {
    unlockedLevelIndex = Math.min(currentLevelIndex + 1, LEVELS.length - 1);
  }

  updateProgressInfo(`Win points +${level.winPoints}`);
  updateNextLevelButton();
}

function renderBoard() {
  const squares = getDisplaySquares();
  const disabledBoard = aiThinking || isGameOverState();
  const checkedKingSquare = isCheckState() ? getKingSquare(game.turn()) : null;
  const showHint = educativeMode && boardHovering && preferredMove && preferredMove.fen === game.fen();
  boardEl.innerHTML = "";

  squares.forEach((square) => {
    const piece = game.get(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "square";
    button.dataset.square = square;
    button.disabled = disabledBoard;

    const isLight = isLightSquare(square);
    button.classList.add(isLight ? "light" : "dark");

    if (selectedSquare === square) {
      button.classList.add("selected");
    }

    if (targetSquares.has(square)) {
      button.classList.add("target");
    }

    if (lastOpponentMove && square === lastOpponentMove.from) {
      button.classList.add("last-opp-from");
    }

    if (lastOpponentMove && square === lastOpponentMove.to) {
      button.classList.add("last-opp-to");
    }

    if (checkedKingSquare && square === checkedKingSquare) {
      button.classList.add("checked-king");
    }

    if (showHint && square === preferredMove.from) {
      button.classList.add("hint-from");
    }

    if (showHint && square === preferredMove.to) {
      button.classList.add("hint-to");
    }

    if (piece) {
      const image = document.createElement("img");
      image.className = "piece-image";
      image.src = PIECE_IMAGES[piece.color + piece.type];
      image.alt = `${friendlyColor(piece.color)} ${PIECE_NAMES[piece.type]}`;
      image.draggable = false;
      button.appendChild(image);
      button.title = image.alt;
    }

    button.addEventListener("click", () => {
      if (selectedSquare === square) {
        clearSelection();
        renderBoard();
        return;
      }
      onSquareClick(square);
    });
    boardEl.appendChild(button);
  });
}

function render() {
  updateInfoText();
  maybeHandleGameEndRewards();
  updateMoveList();
  maybeRequestPreferredMove();
  updateHintText();
  renderBoard();
  updateNextLevelButton();
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

function randomMoveUci() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * moves.length);
  const randomMove = moves[randomIndex];
  return `${randomMove.from}${randomMove.to}${randomMove.promotion || ""}`;
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

function handleHintEngineLine(line) {
  if (hintReadyHandler) {
    hintReadyHandler(line);
  }

  if (hintBestMoveResolver && line.startsWith("bestmove")) {
    const bestMove = line.trim().split(/\s+/)[1];
    const resolver = hintBestMoveResolver;
    hintBestMoveResolver = null;
    hintBestMoveRejecter = null;
    resolver(bestMove);
  }
}

async function ensureHintEngineReady() {
  if (hintReadyPromise) {
    return hintReadyPromise;
  }

  hintReadyPromise = new Promise((resolve, reject) => {
    try {
      hintWorker = createStockfishWorker();
    } catch (error) {
      reject(error);
      return;
    }

    const readyTimeout = setTimeout(() => {
      reject(new Error("Hint engine initialization timed out"));
    }, 10000);

    hintWorker.onmessage = (event) => {
      const line = typeof event.data === "string" ? event.data : String(event.data || "");
      handleHintEngineLine(line);
    };

    hintWorker.onerror = (error) => {
      reject(error);
    };

    hintReadyHandler = (line) => {
      if (line === "uciok") {
        hintWorker.postMessage("isready");
      }
      if (line === "readyok") {
        clearTimeout(readyTimeout);
        hintReadyHandler = null;
        resolve();
      }
    };

    hintWorker.postMessage("uci");
  });

  return hintReadyPromise;
}

async function requestExpertHintMove(fen) {
  await ensureHintEngineReady();

  return new Promise((resolve, reject) => {
    if (!hintWorker) {
      reject(new Error("Hint engine unavailable"));
      return;
    }

    hintBestMoveResolver = resolve;
    hintBestMoveRejecter = reject;
    hintWorker.postMessage(`position fen ${fen}`);
    hintWorker.postMessage(`go depth ${EXPERT_HINT_DEPTH}`);

    const timeout = setTimeout(() => {
      if (hintBestMoveResolver) {
        hintWorker.postMessage("stop");
      }
    }, AI_THINK_TIMEOUT_MS);

    const hardFailTimeout = setTimeout(() => {
      if (hintBestMoveRejecter) {
        const rejecter = hintBestMoveRejecter;
        hintBestMoveResolver = null;
        hintBestMoveRejecter = null;
        rejecter(new Error("Hint move timeout"));
      }
    }, AI_THINK_TIMEOUT_MS + 1000);

    const originalResolve = hintBestMoveResolver;
    hintBestMoveResolver = (move) => {
      clearTimeout(timeout);
      clearTimeout(hardFailTimeout);
      originalResolve(move);
    };
  });
}

async function requestAiMove(fen) {
  await ensureEngineReady();
  const { depth } = getCurrentLevel();

  return new Promise((resolve, reject) => {
    if (!engineWorker) {
      reject(new Error("Engine unavailable"));
      return;
    }

    bestMoveResolver = resolve;
    bestMoveRejecter = reject;
    engineWorker.postMessage(`position fen ${fen}`);
    engineWorker.postMessage(`go depth ${depth}`);

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
  const level = getCurrentLevel();

  if (level.aiMode === "random") {
    aiMove = moveFromUci(randomMoveUci());
  } else if (level.aiMode === "heuristic") {
    aiMove = moveFromUci(fallbackMoveUci());
  } else {
    try {
      const bestMove = await requestAiMove(game.fen());
      aiMove = moveFromUci(bestMove);
    } catch (_error) {
      aiMove = moveFromUci(fallbackMoveUci());
    }
  }

  if (!aiMove) {
    aiThinking = false;
    render();
    return;
  }

  let playedMove = game.move(aiMove);
  if (!playedMove) {
    const fallback = moveFromUci(fallbackMoveUci());
    if (fallback) {
      playedMove = game.move(fallback);
    }
  }

  if (playedMove) {
    lastOpponentMove = { from: playedMove.from, to: playedMove.to };
  }

  aiThinking = false;
  render();
}

async function onSquareClick(square) {
  if (aiThinking || isGameOverState() || !isHumanTurn()) {
    return;
  }

  const piece = game.get(square);
  const isMarkedTarget = targetSquares.has(square);

  if (selectedSquare && isMarkedTarget) {
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
  gameResultAwarded = false;
  preferredMove = null;
  hintRequestFen = null;
  lastOpponentMove = null;
  winnerPingEl.classList.remove("show");
  if (winnerPingTimeout) {
    clearTimeout(winnerPingTimeout);
    winnerPingTimeout = null;
  }
  boardHovering = false;
  updateProgressInfo();
  render();

  if (game.turn() === aiColor) {
    makeAiMove();
  }
}

function setLevel(index) {
  if (Number.isNaN(index) || index < 0 || index >= LEVELS.length) {
    return;
  }

  currentLevelIndex = index;
  updateLevelSelector();
  updateProgressInfo();
  resetGame(humanColor);
}

newGameBtn.addEventListener("click", () => resetGame(humanColor));
playWhiteBtn.addEventListener("click", () => resetGame("w"));
playBlackBtn.addEventListener("click", () => resetGame("b"));
levelSelectEl.addEventListener("change", (event) => {
  const nextIndex = Number(event.target.value);
  setLevel(nextIndex);
});
nextLevelBtn.addEventListener("click", () => {
  if (!canAdvanceToNextLevel()) {
    return;
  }

  setLevel(currentLevelIndex + 1);
});
educativeToggleEl.addEventListener("change", (event) => {
  educativeMode = event.target.checked;
  preferredMove = null;
  hintRequestFen = null;
  boardHovering = false;
  render();
});
boardEl.addEventListener("mouseenter", () => {
  if (!educativeMode) {
    return;
  }

  boardHovering = true;
  maybeRequestPreferredMove();
  updateHintText();
  renderBoard();
});
boardEl.addEventListener("mouseleave", () => {
  if (!educativeMode) {
    return;
  }

  boardHovering = false;
  updateHintText();
  renderBoard();
});

updateLevelSelector();
updateProgressInfo();
scoreTextEl.textContent = String(score);
winsTextEl.textContent = String(totalWins);
updateHintText();
render();
