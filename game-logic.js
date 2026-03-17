let gameState = {
    pNames: ["P1", "P2"],
    scores: [501, 501],
    history: [[], []],
    legScore: [0, 0], // Tracks legs won
    targetLegs: 1, // First to X
    legStarter: 0, // Who started the current leg
    currentIdx: 0,
    mode: 'double',
    input: "",
    logs: [],

    // Statistics Trackers per player [P1, P2]
    stats: [
        {
            oneEighties: 0,
            twentySixes: 0,
            totalPoints: 0,
            dartsThrown: 0,
            pointsPre170: 0,
            dartsPre170: 0,
            dartsToClose: 0,
            isBelow170: false
        },
        {
            oneEighties: 0,
            twentySixes: 0,
            totalPoints: 0,
            dartsThrown: 0,
            pointsPre170: 0,
            dartsPre170: 0,
            dartsToClose: 0,
            isBelow170: false
        }
    ]
};

// Ensure the app waits for the HTML to load
window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

// --- GAME LOGIC ---
function startGame() {
    const p1 = document.getElementById('p1-select').value;
    const p2 = document.getElementById('p2-select').value;
    const startVal = parseInt(document.getElementById('start-score-select').value);
    if (!p1 || !p2) return alert("Select 2 players!");
    const legTarget = parseInt(document.getElementById('legs-to-win-select').value);

    gameState.legScore = [0, 0];
    gameState.targetLegs = legTarget;
    gameState.legStarter = 0; // Player 1 starts the first leg
    gameState.pNames = [p1, p2];
    gameState.scores = [startVal, startVal];
    gameState.history = [[], []];
    gameState.currentIdx = 0;
    gameState.mode = document.getElementById('checkout-mode-select').value;
    gameState.logs = [];

    // HIDE NAVIGATION FOR FOCUS MODE
    document.getElementById('main-nav').style.display = 'none';

    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('active-game-view').style.display = 'block';
    refreshDisplay();
}

function pressKey(num) {
    if (gameState.input.length < 3) {
        gameState.input += num;
        document.getElementById('input-preview').innerText = gameState.input;
    }
}

async function submitTurn() {
    const pts = parseInt(gameState.input) || 0;
    if (pts > 180) return alert("Max is 180!");

    gameState.logs.push(JSON.parse(JSON.stringify(gameState)));

    const currentIdx = gameState.currentIdx;
    const newScore = gameState.scores[currentIdx] - pts;
    const pStats = gameState.stats[currentIdx];

    // --- NEW STATISTICS LOGIC ---
    pStats.dartsThrown += 3; // Standard turn
    pStats.totalPoints += pts;

    // Track 180s and 26s
    if (pts === 180) pStats.oneEighties++;
    if (pts === 26) pStats.twentySixes++;

    // Track "Average until 170"
    if (!pStats.isBelow170) {
        pStats.pointsPre170 += pts;
        pStats.dartsPre170 += 3;
        if (gameState.scores[currentIdx] - pts <= 170) {
            pStats.isBelow170 = true;
        }
    } else {
        // Track "Darts needed to close"
        pStats.dartsToClose += 3;
    }
    // --- END STATISTICS LOGIC ---

    if (newScore === 0) {
        const winnerIdx = gameState.currentIdx;

        // Update both the leg score AND the current score to 0
        gameState.legScore[winnerIdx]++;
        gameState.scores[winnerIdx] = 0; // <--- ADD THIS LINE

        if (typeof refreshDisplay === "function") refreshDisplay();

        // 3. Check if they hit the target (e.g., "First to 1")
        if (gameState.legScore[winnerIdx] >= gameState.targetLegs) {

            // Use a slight timeout for the alert so the UI finishes 'painting' the 1-0 score
            setTimeout(async () => {
                alert(`🏆 MATCH OVER! ${gameState.pNames[winnerIdx]} wins!`);

                try {
                    await saveMatchToSupabase();
                    console.log("Match saved successfully.");

                    // FORCE the scores to match start values so exitGame doesn't trigger
                    const startVal = parseInt(document.getElementById('start-score-select').value);
                    gameState.scores = [startVal, startVal];
                    gameState.legScore = [0, 0];

                    // Now call exit
                    exitGame(true);
                } catch (err) {
                    console.error("Failed to save match:", err);
                    exitGame(true); // Exit anyway so the user isn't stuck
                }
            }, 100);

        } else {
            // Not the end of the match, just the end of a leg
            alert(`Leg won by ${gameState.pNames[winnerIdx]}!`);
            resetForNextLeg();
        }
        return; // Stop the rest of submitTurn from running
    }

    if (newScore < 0 || (newScore === 1 && gameState.mode === 'double')) {
        alert("BUST!");
        gameState.history[currentIdx].push("BUST");
    } else {
        gameState.scores[currentIdx] = newScore;
        gameState.history[currentIdx].push(pts);
    }

    gameState.currentIdx = currentIdx === 0 ? 1 : 0;
    clearInput();
    refreshDisplay();
}

function undoMove() {
    if (gameState.logs.length === 0) return;
    const lastState = gameState.logs.pop();
    Object.assign(gameState, lastState);
    refreshDisplay();
    clearInput();
}

function clearInput() {
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";
}

function resetForNextLeg() {
    const startVal = parseInt(document.getElementById('start-score-select').value);
    gameState.scores = [startVal, startVal];
    gameState.history = [[], []];

    // Switch the leg starter
    gameState.legStarter = gameState.legStarter === 0 ? 1 : 0;
    gameState.currentIdx = gameState.legStarter;

    gameState.input = "";
    refreshDisplay();
}