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
  rank: document.getElementById("overlay-rank"),
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
  const numberRange =
    document.getElementById("input-numbers-range")?.value || 50;

  socket.emit("createGame", {
    numberRange: parseInt(numberRange),
  });
});

document.getElementById("btn-join-game")?.addEventListener("click", () => {
  AudioFX.init();
  const roomInput = document.getElementById("input-room-id")?.value.trim();
  if (!roomInput) return showToast("يرجى إدخال رمز الغرفة!", "error");

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
    readyBtn.innerText = "جاري التحقق... ⏳";
  }
});

socket.on("errorMsg", (msg) => {
  AudioFX.playWrong();
  showToast(msg, "error"); // 👈 استخدام التوست بدلاً من alert

  const readyBtn = document.getElementById("btn-player-ready");
  if (readyBtn && readyBtn.innerText.includes("جاري التحقق")) {
    readyBtn.disabled = false;
    readyBtn.innerText = "أنا مستعد 👍";
  }
});

socket.on("playerLeftMsg", (msg) => {
  showToast(msg, "error");
});

socket.on("promotedToHost", () => {
  showToast("لقد أصبحت المضيف الحالي للغرفة! 👑", "success");
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
    if (!chosenNum) return showToast("يرجى كتابة رقم أولاً!", "error");

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

  currentAvailableNumbers = data.availableNumbers || [];

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

// بالأسئله
// socket.on("sendTriviaQuestion", (questionData) => {
//   isAnswering = false;
//   const qText = document.getElementById("trivia-question-text");
//   const optionsContainer = document.getElementById("trivia-options-container");

//   if (qText) qText.innerText = questionData.question;

//   if (optionsContainer) {
//     optionsContainer.innerHTML = "";
//     questionData.options.forEach((opt) => {
//       const btn = document.createElement("button");
//       btn.className = "btn-answer";
//       btn.innerText = opt;
//       btn.onclick = () => submitAnswer(opt);
//       optionsContainer.appendChild(btn);
//     });
//   } else {
//     questionData.options.forEach((opt, idx) => {
//       const btn = document.getElementById(`btn-answer-${idx + 1}`);
//       if (btn) {
//         btn.innerText = opt;
//         btn.onclick = () => submitAnswer(opt);
//         btn.disabled = false;
//       }
//     });
//   }
// });

// بالألوان
socket.on("sendTriviaQuestion", (questionData) => {
  isAnswering = false;

  const colorPreview = document.getElementById("color-preview-box");
  const optionsContainer = document.getElementById("trivia-options-container");

  // تطبيق اللون على مربع العرض
  if (colorPreview) {
    colorPreview.style.backgroundColor = questionData.targetColorCode;
  }

  if (optionsContainer) {
    optionsContainer.innerHTML = "";

    questionData.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "btn-color-option";
      btn.innerText = ""; //opt.name
      // إضافة شريط ملون صغير أو خلفية للزر لتسهيل الخيار
      btn.style.backgroundColor = `${opt.code}`;
      if (opt.code === "#f8fafc") {
        btn.style.color = `#0f172a`;
      } else {
        btn.style.color = `#f8fafc`;
      }

      btn.onclick = () => submitAnswer(opt.name);
      optionsContainer.appendChild(btn);
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

  // تحديث نص المرتبة والنقاط
  const rankTextElem = document.getElementById("rank-display-text");
  const rankPointsElem = document.getElementById("rank-points-text");

  if (rankTextElem) {
    let rankBadge = `المركز ${data.rank}`;
    if (data.rank === 1) rankBadge = "المركز الأول 🥇";
    else if (data.rank === 2) rankBadge = "المركز الثاني 🥈";
    else if (data.rank === 3) rankBadge = "المركز الثالث 🥉";

    rankTextElem.innerText = `حصلت على الرقم في ${rankBadge}`;
  }

  if (rankPointsElem) {
    rankPointsElem.innerText = `+${data.pointsEarned || 0} نقطة`;
  }

  // إظهار overlay المرتبة الجديدة بدلاً من overlay الانتظار العادية
  showOverlay("rank");
});

socket.on("showTurnTransition", (data) => {
  hideOverlays();

  const turnTitle = document.getElementById("turn-transition-title");
  if (turnTitle) {
    turnTitle.innerText = "انتهى الدور الحالي! ⏳";
  }

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

socket.on("gameOver", (data) => {
  hideOverlays();

  // 1. التبديل إلى شاشة لوحة الصدارة النهائية
  showScreen("leaderboard");

  const finalLeaderboardList = document.getElementById("leaderboard-list");
  if (!finalLeaderboardList) return;

  // 2. تفريغ القائمة من أي بيانات سابقة
  finalLeaderboardList.innerHTML = "";

  const leaderboard = data.leaderboard || [];

  // 3. بناء وتعبئة القائمة بالعناصر
  leaderboard.forEach((player, index) => {
    const item = document.createElement("div"); // التغيير إلى div ليتناسب مع تنسيق CSS الخاص بك

    let rankClass = "";
    if (index === 0) rankClass = "rank-1";
    else if (index === 1) rankClass = "rank-2";
    else if (index === 2) rankClass = "rank-3";

    const disconnectedClass = player.isDisconnected ? "disconnected" : "";
    item.className =
      `leaderboard-item ${rankClass} ${disconnectedClass}`.trim();

    item.innerHTML = `
      <span class="leaderboard-rank">${index + 1}.</span>
      <span class="leaderboard-name">${player.name}</span>
      <span class="leaderboard-score">${player.score || 0} نقطة</span>
    `;

    finalLeaderboardList.appendChild(item);
  });
});

document.getElementById("btn-back-to-main")?.addEventListener("click", () => {
  window.location.reload();
});

socket.on("promotedToHost", () => {
  showToast("لقد أصبحت المضيف الحالي للغرفة! 👑", "error");
});

socket.on("errorMsg", (msg) => {
  AudioFX.playWrong();
  showToast(msg, "error");
});

socket.on("playerLeftMsg", (msg) => {
  console.log(msg);
});

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
  if (maxCountElem) maxCountElem.innerText = maxPlayers || 15;

  const listContainer = document.getElementById("host-players-list");
  if (listContainer) {
    listContainer.innerHTML = "";

    players.forEach((p, idx) => {
      const li = document.createElement("li");
      li.className = "player-status-item";
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.padding = "10px";
      li.style.marginBottom = "6px";
      li.style.borderRadius = "8px";
      li.style.background = "rgba(15, 23, 42, 0.4)";

      li.innerHTML = `
        <span>${p.name} ${p.isHost ? "👑" : ""}</span>
        <span style="color: ${p.isReady ? "#22c55e" : "#94a3b8"}">
          ${p.isReady ? "مستعد ✅" : "بانتظار الاستعداد ⏳"}
        </span>
      `;
      listContainer.appendChild(li);
    });
  }

  const startBtn = document.getElementById("btn-host-start-game");
  if (startBtn) {
    const allReady = players.every((p) => p.isReady || p.isHost);
    // شرط البدء: وجود شخصين على الأقل وجاهزية الجميع
    if (players.length >= 2 && allReady) {
      startBtn.disabled = false;
      startBtn.classList.remove("disabled-btn");
      startBtn.innerText = "بدء اللعب 🔥";
    } else {
      startBtn.disabled = true;
      startBtn.classList.add("disabled-btn");
      if (players.length < 2) {
        startBtn.innerText = "بدء اللعب 🔥 (بانتظار انضمام لاعب آخر على الأقل)";
      } else {
        startBtn.innerText = "بدء اللعب 🔥 (بانتظار استعداد باقي اللاعبين)";
      }
    }
  }
}

function submitAnswer(selectedOption) {
  if (isAnswering) return;
  isAnswering = true;

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

  let allNumbers = Array.from({ length: range }, (_, i) => i + 1);
  let shuffledNumbers = shuffleArray(allNumbers);

  shuffledNumbers.forEach((num) => {
    const div = document.createElement("div");
    const isAvailable = availableList.includes(num);

    if (isAvailable) {
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
            // إرسال الرقم المخمن للسيرفر ليتحقق منه بنفسه
            socket.emit("hunterFoundNumber", {
              roomId: currentRoomId,
              guessedNumber: num,
            });
          } else {
            AudioFX.playWrong();
            div.classList.add("circled-wrong");

            isCooldown = true;
            setTimeout(() => {
              isCooldown = false;
            }, 2000);
          }
        };
      }
    } else {
      div.className = "num-item used-number disabled";
      div.innerText = num;
    }

    gridContainer.appendChild(div);
  });
}

function showToast(message, type = "error") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/* ==========================================
   7. عناصر القائمة المنسدلة والـ Modal المباشرة
   ========================================== */
const fabMainBtn = document.getElementById("fab-main-btn");
const fabDropdown = document.getElementById("fab-dropdown");
const openLeaderboardBtn = document.getElementById("open-leaderboard-btn");
const toggleAudioBtn = document.getElementById("toggle-audio-btn");
const leaderboardModal = document.getElementById("leaderboard-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const liveLeaderboardList = document.getElementById("live-leaderboard-list");

let isAudioMuted = false;
let currentLivePlayers = []; // لتخزين اللاعبين القادمين مباشرة من السيرفر

// 1. فتح/إغلاق القائمة المنسدلة عند النقر على الزر العائم
fabMainBtn?.addEventListener("click", () => {
  fabDropdown?.classList.toggle("hidden");
});

// 2. التحكم بـ كتم/تشغيل الصوت الفعلي (تعديل AudioFX)
toggleAudioBtn?.addEventListener("click", () => {
  isAudioMuted = !isAudioMuted;

  if (isAudioMuted) {
    toggleAudioBtn.textContent = "🔇 الصوت: مكتوم";
    // تعطيل Web Audio API عند الكتم
    if (AudioFX.ctx) AudioFX.ctx.suspend();
  } else {
    toggleAudioBtn.textContent = "🔊 الصوت: مفعل";
    if (AudioFX.ctx) AudioFX.ctx.resume();
  }
});

// تعديل بسيط على تشغيل الصوت للتأكد من حالة الكتم
const originalInit = AudioFX.init.bind(AudioFX);
AudioFX.init = function () {
  if (isAudioMuted) return; // عدم التشغيل إذا كان الصوت مكتوماً
  originalInit();
};

// 3. فتح نافذة لوحة الصدارة
openLeaderboardBtn?.addEventListener("click", () => {
  fabDropdown?.classList.add("hidden"); // إغلاق القائمة
  leaderboardModal?.classList.remove("hidden"); // فتح الـ Modal
  renderLiveLeaderboard(currentLivePlayers); // تحديث القائمة بالبيانات المباشرة
});

// 4. إغلاق الـ Modal
closeModalBtn?.addEventListener("click", () => {
  leaderboardModal?.classList.add("hidden");
});

// إغلاق Modal عند النقر خارجه
leaderboardModal?.addEventListener("click", (e) => {
  if (e.target === leaderboardModal) {
    leaderboardModal.classList.add("hidden");
  }
});

// 5. استقبال حدث السيرفر التلقائي للوحة الصدارة المباشرة
socket.on("updateLiveLeaderboard", (playersData) => {
  currentLivePlayers = playersData || [];

  // إذا كانت النافذة مفتوحة حالياً، نقوم بتحديثها فوراً على الشاشة
  if (leaderboardModal && !leaderboardModal.classList.contains("hidden")) {
    renderLiveLeaderboard(currentLivePlayers);
  }
});

function renderLiveLeaderboard(players = []) {
  if (!liveLeaderboardList) return;

  if (players.length === 0) {
    liveLeaderboardList.innerHTML = `
      <li class="leaderboard-item" style="justify-content: center; opacity: 0.7;">
        لا يوجد لاعبون حالياً...
      </li>`;
    return;
  }

  liveLeaderboardList.innerHTML = players
    .map((player, index) => {
      let rankBadge = `${index + 1}.`;
      if (index === 0) rankBadge = "🥇";
      else if (index === 1) rankBadge = "🥈";
      else if (index === 2) rankBadge = "🥉";

      // 👈 إضافة كلاس disconnected إذا كان اللاعب منقطعاً
      const disconnectedClass = player.isDisconnected ? "disconnected" : "";

      return `
        <li class="leaderboard-item ${disconnectedClass}">
          <span class="player-name">${rankBadge} ${player.name}</span>
          <span class="player-score">${player.score || 0} نقطة</span>
        </li>
      `;
    })
    .join("");
}

/* ==========================================
   التحكم بـ Overlay فيديو الشرح (Local Storage)
   ========================================== */
const YOUTUBE_VIDEO_ID = "09EO3MiPlgM"; // 👈 ضع هنا معرف فيديو يوتيوب الخاص بك
const YOUTUBE_URL = `https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1`;

const tutorialOverlay = document.getElementById("tutorial-overlay");
const openTutorialBtn = document.getElementById("open-tutorial-btn");
const closeTutorialBtn = document.getElementById("close-tutorial-btn");
const tutorialIframe = document.getElementById("tutorial-iframe");

// دالة فتح فيديو الشرح
function showTutorial() {
  if (!tutorialOverlay || !tutorialIframe) return;
  tutorialIframe.src = YOUTUBE_URL;
  tutorialOverlay.classList.remove("hidden");
}

// دالة إغلاق فيديو الشرح وإيقاف التشغيل
function hideTutorial() {
  if (!tutorialOverlay || !tutorialIframe) return;
  tutorialOverlay.classList.add("hidden");
  tutorialIframe.src = ""; // إيقاف الصوت/الفيديو فور الإغلاق
}

// 1. الفحص الآلي عند دخول الموقع (يظهر مرة واحدة فقط في الحياة)
document.addEventListener("DOMContentLoaded", () => {
  const hasSeenTutorial = localStorage.getItem("hasSeenGameTutorial");

  if (!hasSeenTutorial) {
    showTutorial();
    localStorage.setItem("hasSeenGameTutorial", "true");
  }
});

// 2. زر الفتح المباشر من قائمة الإعدادات العلويّة
openTutorialBtn?.addEventListener("click", () => {
  fabDropdown?.classList.add("hidden");
  showTutorial();
});

// 3. أحداث الإغلاق (عند الضغط على X أو الخروج)
closeTutorialBtn?.addEventListener("click", hideTutorial);

tutorialOverlay?.addEventListener("click", (e) => {
  if (e.target === tutorialOverlay) {
    hideTutorial();
  }
});
