const socket = io();

/* ==========================================
   1. محاكي المؤثرات الصوتية (Web Audio API)
   ========================================== */
const AudioFX = {
  ctx: null,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playCorrect() {
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(
      659.25,
      this.ctx.currentTime + 0.2,
    ); // E5

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  },
  playWrong() {
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      110,
      this.ctx.currentTime + 0.25,
    );

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  },
  playTimeOut() {
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.setValueAtTime(220, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  },
};

/* ==========================================
   2. تأثير المفرقعات (Confetti FX)
   ========================================== */
function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = Array.from({ length: 60 }).map(() => ({
    x: Math.random() * canvas.width,
    y: -10,
    r: Math.random() * 6 + 4,
    color: ["#38bdf8", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"][
      Math.floor(Math.random() * 5)
    ],
    vx: (Math.random() - 0.5) * 4,
    vy: Math.random() * 3 + 2,
  }));

  let animationFrame;
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });

    if (particles.some((p) => p.y < canvas.height)) {
      animationFrame = requestAnimationFrame(render);
    } else {
      canvas.remove();
    }
  }
  render();
}

/* ==========================================
   3. العناصر والشاشات المتغيرة
   ========================================== */
const screens = {
  mainMenu: document.getElementById("view-main"),
  hostLobby: document.getElementById("view-host-lobby"),
  playerLobby: document.getElementById("view-player-lobby"),
  leader: document.getElementById("view-leader"),
  hunter: document.getElementById("view-hunter"),
  leaderboard: document.getElementById("view-leaderboard"),
};

const overlays = {
  waitingPeers: document.getElementById("overlay-waiting-peers"),
  turnTransition: document.getElementById("overlay-turn-transition"),
};

let currentRoomId = null;
let myPlayerName = "لاعب";
let isAnswering = false;
let isCooldown = false;
let myCurrentScore = 0;
let currentAvailableNumbers = [];

function showScreen(screenKey) {
  Object.values(screens).forEach((screen) => {
    if (screen) screen.classList.remove("active-view");
  });
  if (screens[screenKey]) screens[screenKey].classList.add("active-view");
}

function showOverlay(overlayKey) {
  if (overlays[overlayKey])
    overlays[overlayKey].classList.add("active-overlay");
}

function hideOverlays() {
  Object.values(overlays).forEach((overlay) => {
    if (overlay) overlay.classList.remove("active-overlay");
  });
}

// خوارزمية لغبطة ترتيب الأرقام (Fisher-Yates Shuffle)
function shuffleArray(array) {
  let shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/* ==========================================
   4. أحداث النقر والتفاعل
   ========================================== */
document.getElementById("btn-create-game")?.addEventListener("click", () => {
  AudioFX.init();
  const playersCount =
    document.getElementById("input-players-count")?.value || 4;
  const numberRange =
    document.getElementById("input-numbers-range")?.value || 50;

  socket.emit("createGame", {
    playersCount: parseInt(playersCount),
    numberRange: parseInt(numberRange),
  });
});

document.getElementById("btn-join-game")?.addEventListener("click", () => {
  AudioFX.init();
  const roomInput = document.getElementById("input-room-id")?.value.trim();
  if (!roomInput) return alert("يرجى إدخال رمز الغرفة!");

  currentRoomId = roomInput;
  socket.emit("joinRoom", { roomId: roomInput });
});

document.getElementById("btn-player-ready")?.addEventListener("click", () => {
  AudioFX.init();
  const nameInput = document.getElementById("input-player-name")?.value.trim();
  if (nameInput) myPlayerName = nameInput;

  socket.emit("playerReady", { roomId: currentRoomId, name: myPlayerName });

  const readyBtn = document.getElementById("btn-player-ready");
  if (readyBtn) {
    readyBtn.disabled = true;
    readyBtn.innerText = "في انتظار بدء اللعبة... ⏳";
  }
});

document
  .getElementById("btn-host-start-game")
  ?.addEventListener("click", () => {
    socket.emit("startGame", { roomId: currentRoomId });
  });

document
  .getElementById("btn-submit-chosen-number")
  ?.addEventListener("click", () => {
    const numInput = document.getElementById("input-chosen-number");
    const chosenNum = numInput?.value.trim();
    if (!chosenNum) return alert("يرجى كتابة رقم أولاً!");

    socket.emit("submitLeaderNumber", {
      roomId: currentRoomId,
      chosenNumber: parseInt(chosenNum),
    });
  });

/* ==========================================
   5. استقبال أحداث السيرفر (Socket Events)
   ========================================== */
socket.on("gameCreated", (data) => {
  currentRoomId = data.roomId;
  const roomCodeElem = document.getElementById("display-host-room-code");
  if (roomCodeElem) roomCodeElem.innerText = data.roomId;

  showScreen("hostLobby");
  updateLobbyUI(data.players, data.maxPlayers);
});

socket.on("joinedRoom", (data) => {
  currentRoomId = data.roomId;
  const roomCodeElem = document.getElementById("display-player-room-code");
  if (roomCodeElem) roomCodeElem.innerText = data.roomId;

  showScreen("playerLobby");
});

socket.on("updateLobby", (data) => {
  updateLobbyUI(data.players, data.maxPlayers);
});

socket.on("timerUpdate", (data) => {
  const timerElems = document.querySelectorAll(".timer-value");
  timerElems.forEach((el) => (el.innerText = data.timeLeft));
  if (data.timeLeft <= 5) AudioFX.playTimeOut();
});

socket.on("roundStarted", (data) => {
  hideOverlays();
  showScreen(data.isLeader ? "leader" : "hunter");

  // حفظ قائمة الأرقام المتاحة القادمة من السيرفر
  currentAvailableNumbers = data.availableNumbers || [];

  // تحديث وعرض النقاط دائماً
  myCurrentScore = data.score || 0;
  updateScoreDisplays(myCurrentScore);

  if (data.isLeader) {
    const selectionBox = document.getElementById("leader-number-selection");
    const triviaBox = document.getElementById("leader-trivia-box");
    if (selectionBox) selectionBox.classList.remove("hidden");
    if (triviaBox) triviaBox.classList.add("hidden");

    const inputNum = document.getElementById("input-chosen-number");
    if (inputNum) inputNum.value = "";

    renderPeerCircles(data.totalHunters, 0);
  } else {
    // إظهار واجهة الانتظار للصياد وتثبيتها لحين تحديد القائد للرقم
    showOverlay("waitingPeers");
    const waitingText = overlays.waitingPeers?.querySelector("h3");
    if (waitingText) {
      waitingText.innerText = `جاري اختيار الرقم من قبل القائد (${data.leaderName}) ⏳`;
    }

    const targetDisplay = document.getElementById("target-number-display");
    if (targetDisplay) targetDisplay.innerText = "--";

    renderHunterGrid(data.numberRange, currentAvailableNumbers, false);
  }
});

socket.on("leaderNumberAccepted", () => {
  AudioFX.playCorrect();
  const selectionBox = document.getElementById("leader-number-selection");
  const triviaBox = document.getElementById("leader-trivia-box");
  if (selectionBox) selectionBox.classList.add("hidden");
  if (triviaBox) triviaBox.classList.remove("hidden");
});

socket.on("startHunting", (data) => {
  hideOverlays();
  const targetDisplay = document.getElementById("target-number-display");
  if (targetDisplay) targetDisplay.innerText = data.targetNumber;

  renderHunterGrid(
    data.numberRange,
    currentAvailableNumbers,
    true,
    data.targetNumber,
  );
});

socket.on("sendTriviaQuestion", (questionData) => {
  isAnswering = false;
  const qText = document.getElementById("trivia-question-text");
  const optionsContainer = document.getElementById("trivia-options-container");

  if (qText) qText.innerText = questionData.question;

  // إذا كان هناك حاوية للأزرار سنقوم بإعادة رسم الأزرار ديناميكياً
  if (optionsContainer) {
    optionsContainer.innerHTML = "";
    questionData.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "btn-answer";
      btn.innerText = opt;
      btn.onclick = () => submitAnswer(opt);
      optionsContainer.appendChild(btn);
    });
  } else {
    // في حال كنت تستخدم الأزرار الثابتة بالأيدي (IDs)
    questionData.options.forEach((opt, idx) => {
      const btn = document.getElementById(`btn-answer-${idx + 1}`);
      if (btn) {
        btn.innerText = opt;
        btn.onclick = () => submitAnswer(opt);
        btn.disabled = false;
      }
    });
  }
});

socket.on("triviaResult", (data) => {
  if (data.success) {
    AudioFX.playCorrect();
  } else {
    AudioFX.playWrong();
  }
  myCurrentScore = data.newScore;
  updateScoreDisplays(myCurrentScore);
});

socket.on("updateHuntersProgress", (data) => {
  renderPeerCircles(data.totalHunters, data.foundCount);
});

socket.on("hunterEarnedPoints", (data) => {
  AudioFX.playCorrect();
  launchConfetti();
  myCurrentScore =
    data.newScore !== undefined
      ? data.newScore
      : myCurrentScore + (data.pointsEarned || 0);
  updateScoreDisplays(myCurrentScore);
  showOverlay("waitingPeers");
});

socket.on("showTurnTransition", (data) => {
  hideOverlays();
  showOverlay("turnTransition");

  let count = data.countdown || 5;
  const timerElem = document.getElementById("countdown-timer");
  if (timerElem) timerElem.innerText = count;

  const interval = setInterval(() => {
    count--;
    if (timerElem) timerElem.innerText = count;
    if (count <= 0) {
      clearInterval(interval);
      hideOverlays();
    }
  }, 1000);
});

/* ==========================================
   استقبال حدث نهاية اللعبة وتحديث اللوحة
   ========================================== */
socket.on("gameOver", (data) => {
  hideOverlays();
  AudioFX.playCorrect();
  launchConfetti(); // إطلاق المفرقعات للترتيب النهائي

  const leaderboardList = document.getElementById("leaderboard-list");
  if (!leaderboardList) return;
  leaderboardList.innerHTML = "";

  const leaderboard = data?.leaderboard || [];

  // ترتيب اللاعبين حسب النقاط تنازلياً (في حال لم تكن مرتبة من السيرفر)
  // وفي حال التعادل، يتم الترتيب حسب ظهورهم في المصفوفة لتجنب أي أخطاء
  leaderboard.sort((a, b) => (b.score || 0) - (a.score || 0));

  leaderboard.forEach((player, index) => {
    const item = document.createElement("div");

    // تحديد الأيقونة والمظهر للمراكز الأولى
    let rankBadge = `${index + 1}`;
    let rankClass = "";

    if (index === 0) {
      rankBadge = "🥇";
      rankClass = "rank-1";
    } else if (index === 1) {
      rankBadge = "🥈";
      rankClass = "rank-2";
    } else if (index === 2) {
      rankBadge = "🥉";
      rankClass = "rank-3";
    }

    item.className = `leaderboard-item ${rankClass}`;
    item.innerHTML = `
      <span class="leaderboard-rank">${rankBadge}</span>
      <span class="leaderboard-name">${player.name || "لاعب"}</span>
      <span class="leaderboard-score">${player.score || 0} نقطة</span>
    `;

    leaderboardList.appendChild(item);
  });

  // الانتقال المباشر لشاشة لوحة الصدارة
  showScreen("leaderboard");
});

// حدث زر العودة للرئيسية من لوحة الصدارة
document.getElementById("btn-back-to-main")?.addEventListener("click", () => {
  showScreen("mainMenu");
});

socket.on("promotedToHost", () => {
  alert("لقد أصبحت المضيف الحالي للغرفة! 👑");
});

socket.on("errorMsg", (msg) => {
  AudioFX.playWrong();
  alert(msg);
});

socket.on("playerLeftMsg", (msg) => alert(msg));

/* ==========================================
   6. الدوال المساعدة للرسم والتحديث
   ========================================== */
function updateScoreDisplays(score) {
  const leaderScoreElem = document.getElementById("leader-score");
  const hunterScoreElem = document.getElementById("hunter-score");

  if (leaderScoreElem) leaderScoreElem.innerText = score;
  if (hunterScoreElem) hunterScoreElem.innerText = score;
}

function updateLobbyUI(players, maxPlayers) {
  const joinedCountElem = document.getElementById("joined-count");
  const maxCountElem = document.getElementById("max-count");
  if (joinedCountElem) joinedCountElem.innerText = players.length;
  if (maxCountElem) maxCountElem.innerText = maxPlayers;

  const listContainer = document.getElementById("host-players-list");
  if (listContainer) {
    listContainer.innerHTML = "";

    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      const li = document.createElement("li");
      li.className = "player-status-item";
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.padding = "10px";
      li.style.marginBottom = "6px";
      li.style.borderRadius = "8px";
      li.style.background = "rgba(15, 23, 42, 0.4)";

      if (p) {
        li.innerHTML = `
          <span>${p.name} ${p.isHost ? "👑" : ""}</span>
          <span style="color: ${p.isReady ? "#22c55e" : "#94a3b8"}">
            ${p.isReady ? "مستعد ✅" : "بانتظار الاستعداد ⏳"}
          </span>
        `;
      } else {
        li.style.border = "1px dashed rgba(255, 255, 255, 0.2)";
        li.innerHTML = `
          <span style="color: #64748b;">خانة شاغرة (${i + 1})</span>
          <span style="color: #64748b;">في انتظار الانضمام...</span>
        `;
      }
      listContainer.appendChild(li);
    }
  }

  const startBtn = document.getElementById("btn-host-start-game");
  if (startBtn) {
    const allReady = players.every((p) => p.isReady || p.isHost);
    if (players.length >= 2 && allReady) {
      startBtn.disabled = false;
      startBtn.classList.remove("disabled-btn");
      startBtn.innerText = "بدء اللعب 🔥";
    } else {
      startBtn.disabled = true;
      startBtn.classList.add("disabled-btn");
      startBtn.innerText = "بدء اللعب 🔥 (بانتظار اكتمال اللاعبين)";
    }
  }
}

function submitAnswer(selectedOption) {
  if (isAnswering) return;
  isAnswering = true;

  // تعطيل كل أزرار الإجابات لمنع الضغط المتعدد
  const allAnswerBtns = document.querySelectorAll(".btn-answer");
  allAnswerBtns.forEach((btn) => (btn.disabled = true));

  socket.emit("answerTrivia", {
    roomId: currentRoomId,
    selectedOption: selectedOption,
  });
}

function renderPeerCircles(total, foundCount) {
  const container = document.getElementById("peers-circles-list");
  if (!container) return;
  container.innerHTML = "";

  for (let i = 0; i < total; i++) {
    const circle = document.createElement("div");
    circle.className = `peer-circle ${i < foundCount ? "active" : ""}`;
    circle.innerText = i + 1;
    container.appendChild(circle);
  }
}

function renderHunterGrid(range, availableList, active, targetNumber = null) {
  const gridContainer = document.getElementById("numbers-grid");
  if (!gridContainer) return;
  gridContainer.innerHTML = "";

  // 1. إنشاء مصفوفة تحتوي على كل الأرقام من 1 إلى Range
  let allNumbers = Array.from({ length: range }, (_, i) => i + 1);

  // 2. خلط جميع الأرقام ببعضها بشكل عشوائي كاملاً (المتاح والمستبعد معاً)
  let shuffledNumbers = shuffleArray(allNumbers);

  // 3. رسم جميع الأرقام حسب ترتيبها العشوائي المخلوط
  shuffledNumbers.forEach((num) => {
    const div = document.createElement("div");
    const isAvailable = availableList.includes(num);

    if (isAvailable) {
      // الرقم متاح وقابل للاختيار
      div.className = "num-item";
      div.innerText = num;

      if (active) {
        div.onclick = () => {
          if (
            isCooldown ||
            div.classList.contains("circled-wrong") ||
            div.classList.contains("circled")
          )
            return;

          if (num === targetNumber) {
            div.classList.add("circled");
            socket.emit("hunterFoundNumber", { roomId: currentRoomId });
          } else {
            AudioFX.playWrong();
            div.classList.add("circled-wrong");

            isCooldown = true;
            setTimeout(() => {
              isCooldown = false;
            }, 1000);
          }
        };
      }
    } else {
      // الرقم مستبعد وتم اختياره في جولات سابقة
      div.className = "num-item used-number disabled";
      div.innerText = num;
    }

    gridContainer.appendChild(div);
  });
}
