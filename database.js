// Connect to the Database via Supabase
const SUPABASE_URL = 'https://daejfzypbnwtucwftkzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xajv6XFl28cNrdMSohDhjg_aDyMT3Bl';
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let players    = [];
let rawHistory = [];   // full unfiltered history — used by time filter

// ── COMPUTE STATS FOR A PLAYER GIVEN A HISTORY SUBSET ──
function computeStats(history) {
    const totalGames = history.length;
    const gamesWon   = history.filter(h => h.is_win).length;
    const total180s  = history.reduce((sum, h) => sum + (h.one_eighties || 0), 0);
    const total26s   = history.reduce((sum, h) => sum + (h.twenty_sixes  || 0), 0);
    const avgGame    = totalGames > 0
        ? (history.reduce((sum, h) => sum + h.avg_game,    0) / totalGames).toFixed(2)
        : '0.00';
    const avgPre170  = totalGames > 0
        ? (history.reduce((sum, h) => sum + h.avg_pre_170, 0) / totalGames).toFixed(2)
        : '0.00';
    return {
        totalGames,
        gamesWon,
        gamesLost: totalGames - gamesWon,
        winRatio:  totalGames > 0 ? ((gamesWon / totalGames) * 100).toFixed(0) : 0,
        total180s,
        total26s,
        avgGame,
        avgPre170
    };
}

// ── APPLY A TIME FILTER AND RE-RENDER LEADERBOARD ──
function applyFilter(fromDate) {
    const filtered = fromDate
        ? rawHistory.filter(h => new Date(h.created_at) >= fromDate)
        : rawHistory;

    players = players.map(player => ({
        ...player,
        stats: computeStats(filtered.filter(h => h.player_id === player.id))
    }));

    players.sort((a, b) => {
        if (b.stats.winRatio !== a.stats.winRatio) return b.stats.winRatio - a.stats.winRatio;
        return b.stats.avgGame - a.stats.avgGame;
    });

    if (typeof updateStatsUI === 'function') updateStatsUI();
}

// --- DB ACTIONS ---
async function fetchPlayers() {
    // 1. Fetch Players and History simultaneously
    const [pRes, hRes] = await Promise.all([
        supa.from('players').select('*').order('name'),
        supa.from('game_history').select('*')
    ]);

    if (pRes.error || hRes.error) {
        console.error("Fetch Error:", pRes.error || hRes.error);
        return;
    }

    const rawPlayers = pRes.data || [];
    rawHistory       = hRes.data || [];

    // 2. Attach stats to each player object
    players = rawPlayers.map(player => ({
        ...player,
        stats: computeStats(rawHistory.filter(h => h.player_id === player.id))
    }));

    players.sort((a, b) => {
        // 1. Primary Sort: Win Rate (Highest first)
        if (b.stats.winRatio !== a.stats.winRatio) {
            return b.stats.winRatio - a.stats.winRatio;
        }
        // 2. Secondary Sort (Tie-breaker): Lifetime Average
        return b.stats.avgGame - a.stats.avgGame;
    });

    // Update the UI — functions may not exist on every page
    if (typeof updateDropdowns === 'function') updateDropdowns();
    if (typeof updateStatsUI === 'function') updateStatsUI();
}

// Add new Members to the Club
async function registerPlayer() {
    const name = document.getElementById('reg-name').value.trim();
    if (!name) return;
    const { error } = await supa.from('players').insert([{ name }]);
    if (error) {
        alert(error.message);
    } else {
        document.getElementById('reg-name').value = "";
        await fetchPlayers(); // This now updates both dropdowns and dashboard
    }
}

// Delete Members from the Club
async function deletePlayer(playerId, playerName) {
    const confirmFirst = confirm(`⚠️ DANGER: Are you sure you want to delete "${playerName}"?`);
    if (!confirmFirst) return;

    const confirmSecond = confirm(`LAST WARNING: This will also delete ALL match history for ${playerName}. This cannot be undone!`);
    if (!confirmSecond) return;

    // 1. Delete Match History first (Cascade)
    const { error: matchError } = await supa
        .from('game_history')
        .delete()
        .eq('player_id', playerId);

    if (matchError) {
        console.error("Error clearing match history:", matchError);
    }

    // 2. Delete Player from 'players' table
    const { error: playerError } = await supa
        .from('players')
        .delete()
        .eq('id', playerId);

    if (playerError) {
        alert("Error deleting player: " + playerError.message);
        return;
    }

    // 3. Refresh the entire app state
    await fetchPlayers();
    showPage('stats-page'); // Redirect back to the leaderboard
    alert(`${playerName} has been removed from the club.`);
}

// Sends the Statistics of both Players to Supabase
async function saveMatchToSupabase() {
    // Check if players array actually has data
    if (!players || players.length === 0) {
        console.error("No players loaded. Refreshing...");
        await fetchPlayers();
    }
    console.log("Saving match statistics...");

    for (let i = 0; i < 2; i++) {
        console.log("Saving match statistics...");
        const pName = gameState.pNames[i];
        // The opponent is the "other" index (if i is 0, opponent is 1; if i is 1, opponent is 0)
        const opponentIdx = i === 0 ? 1 : 0;
        const pStats = gameState.stats[i];
        const legsWon = Number(gameState.legScore[i]);
        const legsLost = Number(gameState.legScore[opponentIdx]);

        // Find the player's UUID from our local 'players' list
        const playerObj = players.find(p => p.name === pName);
        if (!playerObj) continue;

        // Calculate Averages
        const gameAvg = pStats.dartsThrown > 0
            ? (pStats.totalPoints / (pStats.dartsThrown / 3)).toFixed(2)
            : 0;

        const pre170Avg = pStats.dartsPre170 > 0
            ? (pStats.pointsPre170 / (pStats.dartsPre170 / 3)).toFixed(2)
            : 0;

        const matchData = {
            player_id: playerObj.id,
            player_name: pName,
            opponent_name: gameState.pNames[opponentIdx],
            // Explicitly force a Boolean result
            is_win: legsWon > legsLost,
            legs_won: legsWon,
            legs_lost: legsLost,
            leg_count: legsWon + legsLost,
            avg_game: parseFloat(gameAvg),
            avg_pre_170: parseFloat(pre170Avg),
            one_eighties: pStats.oneEighties,
            twenty_sixes: pStats.twentySixes,
            high_finishes: pStats.highFinishes,
            highest_finish: pStats.highestFinish,
            closing_darts: pStats.dartsToClose
        };

        const { error } = await supa.from('game_history').insert([matchData]);
        if (error) {
            console.error(`Supabase Error for ${pName}:`, error.message);
        } else {
            console.log(`Stats saved for ${pName}`);
        }
    }
}

// Function to delete single Games
async function deleteMatch(matchId, playerId) {
    const confirmDelete = confirm("Are you sure you want to delete this match record? This will permanently change player statistics.");

    if (!confirmDelete) return;

    // 1. Delete from Supabase
    const { error } = await supa
        .from('game_history')
        .delete()
        .eq('id', matchId);

    if (error) {
        alert("Error deleting match: " + error.message);
        return;
    }

    // 2. Re-fetch all data to recalculate averages and update leaderboard
    await fetchPlayers();

    // 3. Refresh the current profile view to show the updated history
    openPlayerProfile(playerId);
}

window.saveMatchToSupabase = saveMatchToSupabase;