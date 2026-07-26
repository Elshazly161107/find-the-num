const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = {};
const triviaQuestions = require("./questions.json");
// const triviaColors = [
//   "black",
//   "red",
//   "yellow",
//   "blue",
//   "green",
//   "pink",
//   "orange",
//   "white",
//   "silver",
//   "purple",
// ];
// مصفوفة الألوان المتاحة (يمكنك الإضافة والتعديل عليها بحرية)
const COLOR_PALETTE = [
  { name: "أحمر", code: "#ff0000" },
  { name: "أزرق", code: "#0062ff" },
  { name: "أخضر", code: "#00ff5e" },
  { name: "أصفر", code: "#ffcd38" },
  { name: "بنفسجي", code: "#8400ff" },
  { name: "برتقالي", code: "#ed6300" },
  { name: "وردي", code: "#ff0080" },
  { name: "أسود", code: "#000000" },
  { name: "أبيض", code: "#ffffff" },
  { name: "رمادي", code: "#939496" },
  { name: "بني", code: "#592100" },
];
const MAX_ROOM_PLAYERS = 15; // الحد الأقصى للاعبين في أي غرفة

io.on("connection", (socket) => {
  // 1. إنشاء غرفة جديدة (تم إلغاء تحديد عدد اللاعبين من المضيف)
  socket.on("createGame", ({ numberRange }) => {
    let roomId;
    // توليد رقم غرفة فريد لضمان عدم وجود غرفة سابقة بنفس المعرف
    do {
      roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]); // استمر في التوليد طالما أن الرقم مستخدم بالفعل
    const rangeNum = parseInt(numberRange) || 50;

    rooms[roomId] = {
      roomId: roomId,
      maxPlayers: MAX_ROOM_PLAYERS,
      numberRange: rangeNum,
      players: [],
      disconnectedPlayers: [],
      availableNumbers: Array.from({ length: rangeNum }, (_, i) => i + 1),
      leaderIndex: 0,
      targetNumber: null,
      foundHunters: [],
      timer: null,
      roundTimeout: null, // 👈 أضفنا هذا السطر لإلغاء المؤقتات لاحقاً
      timeLeft: 30,
      isGameStarted: false,
    };

    const player = {
      id: socket.id,
      name: "المضيف 👑",
      isHost: true,
      isReady: true,
      score: 0,
    };

    rooms[roomId].players.push(player);
    socket.join(roomId);

    socket.emit("gameCreated", {
      roomId: roomId,
      maxPlayers: MAX_ROOM_PLAYERS,
      players: rooms[roomId].players,
    });
  });

  // 2. انضمام لاعب للغرفة (بحد أقصى 15 لاعب)
  socket.on("joinRoom", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("errorMsg", "الغرفة غير موجودة!");
    if (room.players.length >= MAX_ROOM_PLAYERS) {
      return socket.emit("errorMsg", "الغرفة ممتلئة! الحد الأقصى 15 لاعب.");
    }
    if (room.isGameStarted) {
      return socket.emit(
        "errorMsg",
        "اللعبة بدأت بالفعل، لا يمكنك الانضمام الآن!",
      );
    }

    socket.join(roomId);
    socket.emit("joinedRoom", { roomId: roomId });
  });

  // 3. تجهيز الاسم والاستعداد (بعد الحماية والتأكد من عدم التكرار)
  socket.on("playerReady", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    // 🔒 1. تطهير الاسم وحذف الرموز والوسوم الخطيرة لدرء ثغرات XSS
    let cleanName = (name || "لاعب")
      .toString()
      .trim()
      .replace(/<[^>]*>?/gm, ""); // إزالة أي وسوم HTML

    if (cleanName.length === 0) cleanName = "لاعب";
    if (cleanName.length > 15) cleanName = cleanName.substring(0, 15); // تحديد أقصى طول للاسم

    // 🔒 2. التحقق من عدم تكرار الاسم داخل نفس الغرفة للاعبين الآخرين
    const isNameTaken = room.players.some(
      (p) =>
        p.id !== socket.id && p.name.toLowerCase() === cleanName.toLowerCase(),
    );

    if (isNameTaken) {
      return socket.emit(
        "errorMsg",
        "هذا الاسم مستخدم بالفعل في الغرفة، اختر اسماً آخر!",
      );
    }

    let player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: cleanName,
        isHost: false,
        isReady: true,
        score: 0,
      };
      room.players.push(player);
    } else {
      player.name = cleanName;
      player.isReady = true;
    }

    io.to(roomId).emit("updateLobby", {
      players: room.players,
      maxPlayers: MAX_ROOM_PLAYERS,
    });

    broadcastLiveLeaderboard(roomId);
  });

  // 4. بدء اللعبة
  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.isGameStarted = true;
    startNewRound(roomId);
  });

  // 5. اختيار القائد للرقم
  socket.on("submitLeaderNumber", ({ roomId, chosenNumber }) => {
    const room = rooms[roomId];
    if (!room) return;

    const num = parseInt(chosenNumber);

    if (isNaN(num)) {
      return socket.emit("errorMsg", "يرجى إدخال رقم صحيح!");
    }

    if (num < 1 || num > room.numberRange) {
      return socket.emit("errorMsg", `اختر رقماً بين 1 و ${room.numberRange}`);
    }

    if (!room.availableNumbers.includes(num)) {
      return socket.emit("errorMsg", "هذا الرقم تم اختياره سابقاً!");
    }

    room.targetNumber = num;
    socket.emit("leaderNumberAccepted");

    // تعديل هنا: نمرر roomId و socket
    sendNextQuestion(roomId, socket);

    io.to(roomId).emit("startHunting", {
      targetNumber: room.targetNumber,
      numberRange: room.numberRange,
      foundNumbers: [],
    });

    startRoundTimer(roomId);
  });

  // 6. إجابة القائد
  socket.on("answerTrivia", ({ roomId, selectedOption }) => {
    const room = rooms[roomId];
    if (!room) return;

    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id !== socket.id) return;

    // المقارنة مع الإجابة المحفوظة في الغرفة
    const isCorrect = selectedOption === room.currentCorrectAnswer;

    if (isCorrect) {
      leader.score++;
      broadcastLiveLeaderboard(roomId);
    }

    socket.emit("triviaResult", {
      success: isCorrect,
      newScore: leader.score,
    });

    // توليد السؤال التالي إذا كان الوقت المتبقي أكبر من 0
    if (room.timeLeft > 0) {
      sendNextQuestion(roomId, socket);
    }
  });

  // 7. صيد الرقم بواسطة الصياد (بعد التأمين)
  socket.on("hunterFoundNumber", ({ roomId, guessedNumber }) => {
    const room = rooms[roomId];
    if (!room || !room.isGameStarted) return;

    // 🔒 التحقق 1: التأكد من أن اللاعب هو صياد وليس القائد
    const leader = room.players[room.leaderIndex];
    if (leader && leader.id === socket.id) return;

    // 🔒 التحقق 2: التأكد من أن الرقم المخمن طابق الرقم المطلوب فعلياً
    const num = parseInt(guessedNumber);
    if (isNaN(num) || num !== room.targetNumber) {
      return socket.emit("errorMsg", "إجابة خاطئة أو تلاعب في الطلب!");
    }

    // 🔒 التحقق 3: عدم تكرار تسجيل اللاعب إذا كان قد وجده سابقاً
    if (room.foundHunters.includes(socket.id)) return;
    room.foundHunters.push(socket.id);

    const rank = room.foundHunters.length;
    let pointsEarned = 0;

    if (rank === 1) pointsEarned = 10;
    else if (rank === 2) pointsEarned = 7;
    else if (rank === 3) pointsEarned = 5;
    else pointsEarned = 2;

    const hunter = room.players.find((p) => p.id === socket.id);
    if (hunter) {
      hunter.score += pointsEarned;

      socket.emit("hunterEarnedPoints", {
        pointsEarned: pointsEarned,
        newScore: hunter.score,
        rank: rank,
      });

      broadcastLiveLeaderboard(roomId);
    }

    if (leader) {
      io.to(leader.id).emit("updateHuntersProgress", {
        totalHunters: room.players.length - 1,
        foundCount: room.foundHunters.length,
      });
    }

    if (room.foundHunters.length >= room.players.length - 1) {
      clearInterval(room.timer);
      endRound(roomId);
    }
  });

  // 8. التعامل الكامل مع خروج أو انقطاع اتصال اللاعب (Disconnect)
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        const disconnectedPlayer = room.players[playerIndex];
        const wasLeader = room.leaderIndex === playerIndex;

        // 🔥 إضافة أوبجيكت بسيط بالاسم والنقاط فقط إلى قائمة المنقطعين
        if (!room.disconnectedPlayers) room.disconnectedPlayers = [];

        // فحص إذا كان اسم اللاعب متواجد سابقاً لحفظ أحدث نقاط وصل إليها
        const existingDiscIdx = room.disconnectedPlayers.findIndex(
          (p) => p.name === disconnectedPlayer.name,
        );
        if (existingDiscIdx !== -1) {
          room.disconnectedPlayers[existingDiscIdx].score =
            disconnectedPlayer.score;
        } else {
          room.disconnectedPlayers.push({
            name: disconnectedPlayer.name,
            score: disconnectedPlayer.score,
            isDisconnected: true,
          });
        }

        // أ) إزالة اللاعب من الغرفة المباشرة
        room.players.splice(playerIndex, 1);

        // ب) إزالته من قائمة من وجدوا الرقم في الجولة الحالية إن وجد
        room.foundHunters = room.foundHunters.filter((id) => id !== socket.id);

        // 🔥 تحديث لوحة الصدارة المباشرة فوراً بعد دمج المنقطعين
        broadcastLiveLeaderboard(roomId);

        // جـ) إذا أصبحت الغرفة فارغة تماماً، حذف الغرفة وإلغاء المؤقت
        if (room.players.length === 0) {
          if (room.timer) clearInterval(room.timer);
          if (room.roundTimeout) clearTimeout(room.roundTimeout);
          break;
        }

        // د) نقل الملكية (Host) إذا خرج المضيف
        if (disconnectedPlayer.isHost && room.players.length > 0) {
          room.players[0].isHost = true;
          io.to(room.players[0].id).emit("promotedToHost");
        }

        // إشعار بقية اللاعبين بخروج اللاعب
        io.to(roomId).emit(
          "playerLeftMsg",
          `${disconnectedPlayer.name} غادر اللعبة.`,
        );

        // هـ) إذا كانت اللعبة قد بدأت بالفعل:
        if (room.isGameStarted) {
          if (room.players.length < 2) {
            clearInterval(room.timer);
            io.to(roomId).emit(
              "errorMsg",
              "تم إنهاء اللعبة لعدم وجود عدد كافٍ من اللاعبين!",
            );
            return handleGameOver(roomId);
          }

          if (wasLeader) {
            clearInterval(room.timer);
            room.leaderIndex =
              (playerIndex - 1 + room.players.length) % room.players.length;
            io.to(roomId).emit(
              "errorMsg",
              "انقطع اتصال القائد! جاري الانتقال للجولة التالية...",
            );
            endRound(roomId);
            break;
          }

          if (room.foundHunters.length >= room.players.length - 1) {
            clearInterval(room.timer);
            endRound(roomId);
            break;
          } else {
            const currentLeader = room.players[room.leaderIndex];
            if (currentLeader) {
              io.to(currentLeader.id).emit("updateHuntersProgress", {
                totalHunters: room.players.length - 1,
                foundCount: room.foundHunters.length,
              });
            }
          }
        } else {
          if (room.leaderIndex >= room.players.length) {
            room.leaderIndex = 0;
          }
          io.to(roomId).emit("updateLobby", {
            players: room.players,
            maxPlayers: MAX_ROOM_PLAYERS,
          });
        }

        break;
      }
    }
  });
});

// === الدوال المساعدة ===

function startNewRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.targetNumber) {
    room.availableNumbers = room.availableNumbers.filter(
      (n) => n !== room.targetNumber,
    );
  }

  if (room.availableNumbers.length === 0 || room.players.length < 2) {
    return handleGameOver(roomId);
  }

  room.foundHunters = [];
  room.targetNumber = null;
  room.timeLeft = 30;

  // حماية مؤشر القائد في حال تغيّر عدد اللاعبين
  if (room.leaderIndex >= room.players.length) {
    room.leaderIndex = 0;
  }

  const leaderPlayer = room.players[room.leaderIndex];

  room.players.forEach((p) => {
    const isLeader = p.id === leaderPlayer.id;
    io.to(p.id).emit("roundStarted", {
      isLeader: isLeader,
      leaderName: leaderPlayer.name || "القائد",
      score: p.score,
      numberRange: room.numberRange,
      totalHunters: room.players.length - 1,
      availableNumbers: room.availableNumbers,
    });
  });
}

function startRoundTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endRound(roomId);
    }
  }, 1000);
}

// الأسئله
// function sendNextQuestion(socket) {
//   const q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
//   socket.currentCorrectAnswer = q.correct;

//   const shuffledOptions = [...q.options].sort(() => Math.random() - 0.5);

//   socket.emit("sendTriviaQuestion", {
//     question: q.question,
//     options: shuffledOptions,
//   });
// }

// بالألوان
function sendNextQuestion(roomId, leaderSocket) {
  const room = rooms[roomId];
  if (!room) return;

  // 1. اختيار اللون الهدف عشوائياً
  const targetColorObj =
    COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];

  // حفظ الإجابة الصحيحة داخل الغرفة نفسها بدلاً من الـ socket
  room.currentCorrectAnswer = targetColorObj.name;

  // 2. اختيار لونين أخيرين عشوائيين مختلفين
  const otherColors = COLOR_PALETTE.filter(
    (c) => c.name !== targetColorObj.name,
  );
  const shuffledOthers = [...otherColors].sort(() => Math.random() - 0.5);

  // 3. دمج الألوان الثلاثة وخلطها
  const selectedThree = [targetColorObj, shuffledOthers[0], shuffledOthers[1]];
  const shuffledOptions = selectedThree.sort(() => Math.random() - 0.5);

  // 4. إرسال السؤال للقائد
  leaderSocket.emit("sendTriviaQuestion", {
    targetColorCode: targetColorObj.code,
    options: shuffledOptions.map((c) => ({ name: c.name, code: c.code })),
  });
}

function endRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // إيقاف مؤقت الثواني للجولة الحالية إن وجد
  if (room.timer) clearInterval(room.timer);

  // التبديل للقائد التالي بأمان
  if (room.players.length > 0) {
    room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
  }

  io.to(roomId).emit("showTurnTransition", { countdown: 5 });

  // إلغاء أي انتقالات سابقة معلقة إن وجدت
  if (room.roundTimeout) clearTimeout(room.roundTimeout);

  // تخزين مرجع الـ Timeout
  room.roundTimeout = setTimeout(() => {
    // التأكد التام من أن الغرفة ما زالت قائمة قبل بدء الجولة
    if (rooms[roomId]) {
      startNewRound(roomId);
    }
  }, 5000);
}

// دالة بث الليد بورد المباشرة
function broadcastLiveLeaderboard(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const activePlayers = room.players.map((p) => ({
    name: p.name,
    score: p.score,
    isDisconnected: false,
  }));

  const disconnected = (room.disconnectedPlayers || []).map((p) => ({
    ...p,
    isDisconnected: true,
  }));

  const leaderboardData = [...activePlayers, ...disconnected].sort(
    (a, b) => b.score - a.score,
  );

  io.to(roomId).emit("updateLiveLeaderboard", leaderboardData);
}

// دالة إنهاء اللعبة والنتيجة النهائية
function handleGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timer) clearInterval(room.timer);
  if (room.roundTimeout) clearTimeout(room.roundTimeout);

  const activePlayers = room.players.map((p) => ({
    name: p.name,
    score: p.score,
    isDisconnected: false,
  }));

  const disconnected = (room.disconnectedPlayers || []).map((p) => ({
    ...p,
    isDisconnected: true,
  }));

  const leaderboard = [...activePlayers, ...disconnected].sort(
    (a, b) => b.score - a.score,
  );

  io.to(roomId).emit("gameOver", { leaderboard: leaderboard });
  delete rooms[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
