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
const MAX_ROOM_PLAYERS = 15; // الحد الأقصى للاعبين في أي غرفة

io.on("connection", (socket) => {
  // 1. إنشاء غرفة جديدة (تم إلغاء تحديد عدد اللاعبين من المضيف)
  socket.on("createGame", ({ numberRange }) => {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const rangeNum = parseInt(numberRange) || 50;

    rooms[roomId] = {
      roomId: roomId,
      maxPlayers: MAX_ROOM_PLAYERS,
      numberRange: rangeNum,
      players: [],
      availableNumbers: Array.from({ length: rangeNum }, (_, i) => i + 1),
      leaderIndex: 0,
      targetNumber: null,
      foundHunters: [],
      timer: null,
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

  // 3. تجهيز الاسم والاستعداد
  socket.on("playerReady", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    let player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      player = {
        id: socket.id,
        name: name || "لاعب",
        isHost: false,
        isReady: true,
        score: 0,
      };
      room.players.push(player);
    } else {
      player.name = name || player.name;
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

    sendNextQuestion(socket);

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

    const isCorrect = selectedOption === socket.currentCorrectAnswer;

    if (isCorrect) {
      leader.score += 1;
      broadcastLiveLeaderboard(roomId); // <--- أضف هنا
    }

    socket.emit("triviaResult", {
      success: isCorrect,
      newScore: leader.score,
    });

    if (room.timeLeft > 0) {
      sendNextQuestion(socket);
    }
  });

  // 7. صيد الرقم بواسطة الصياد
  socket.on("hunterFoundNumber", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

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
        rank: rank, // <--- أضفنا المرتبة هنا
      });

      broadcastLiveLeaderboard(roomId);
    }

    const leader = room.players[room.leaderIndex];
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

        // أ) إزالة اللاعب من الغرفة
        room.players.splice(playerIndex, 1);

        // 🔥 تحديث لوحة الصدارة المباشرة فور خروج اللاعب لتستبعده عند البقية
        broadcastLiveLeaderboard(roomId);

        // ب) إزالته من قائمة من وجدوا الرقم في الجولة الحالية إن وجد
        room.foundHunters = room.foundHunters.filter((id) => id !== socket.id);

        // جـ) إذا أصبحت الغرفة فارغة تماماً، حذف الغرفة وإلغاء المؤقت
        if (room.players.length === 0) {
          clearInterval(room.timer);
          delete rooms[roomId];
          break;
        }

        // د) نقل الملكية (Host) إذا خرج المضيف وكان هناك لاعبون آخرون
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
          // إذا كان متبقي أقل من 2 لاعبين، تنهى اللعبة فوراً
          if (room.players.length < 2) {
            clearInterval(room.timer);
            io.to(roomId).emit(
              "errorMsg",
              "تم إنهاء اللعبة لعدم وجود عدد كافٍ من اللاعبين!",
            );
            return handleGameOver(roomId);
          }

          // إذا كان اللاعب المغادر هو "القائد" الحالي في الجولة:
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

          // إذا كان الخارج "صياد":
          if (room.foundHunters.length >= room.players.length - 1) {
            clearInterval(room.timer);
            endRound(roomId);
            break;
          } else {
            // تحديث مؤشر تقدم الصيادين لدى القائد
            const currentLeader = room.players[room.leaderIndex];
            if (currentLeader) {
              io.to(currentLeader.id).emit("updateHuntersProgress", {
                totalHunters: room.players.length - 1,
                foundCount: room.foundHunters.length,
              });
            }
          }
        } else {
          // إذا كانت اللعبة ما زالت في اللوبي:
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

function sendNextQuestion(socket) {
  const q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
  socket.currentCorrectAnswer = q.correct;

  const shuffledOptions = [...q.options].sort(() => Math.random() - 0.5);

  socket.emit("sendTriviaQuestion", {
    question: q.question,
    options: shuffledOptions,
  });
}

function endRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // التبديل للقائد التالي بأمان
  if (room.players.length > 0) {
    room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
  }

  io.to(roomId).emit("showTurnTransition", { countdown: 5 });

  setTimeout(() => {
    startNewRound(roomId);
  }, 5000);
}

// دالة لبث لوحة الصدارة المباشرة لجميع أعضاء الغرفة
function broadcastLiveLeaderboard(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const leaderboardData = room.players
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);

  io.to(roomId).emit("updateLiveLeaderboard", leaderboardData);
}

function handleGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const leaderboard = [...room.players].sort((a, b) => b.score - a.score);

  io.to(roomId).emit("gameOver", { leaderboard: leaderboard });
  delete rooms[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
