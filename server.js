const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// خدمة كافة ملفات الواجهة (HTML, CSS, JS) من مجلد public
app.use(express.static(path.join(__dirname, "public")));

// مسار الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// تخزين بيانات الغرف
const rooms = {};

// أسئلة Trivia مع 4 خيارات لكل سؤال
const triviaQuestions = [
  {
    question: "كم عدد قارات العالم؟",
    options: ["7", "5", "6", "8"],
    correct: "7",
  },
  {
    question: "ما هي عاصمة فرنسا؟",
    options: ["باريس", "ليون", "مارسيليا", "نيس"],
    correct: "باريس",
  },
  {
    question: "أكبر كوكب في المجموعة الشمسية هو:",
    options: ["المشتري", "زحل", "المريخ", "الأرض"],
    correct: "المشتري",
  },
];

io.on("connection", (socket) => {
  // 1. إنشاء غرفة جديدة
  socket.on("createGame", ({ playersCount, numberRange }) => {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const rangeNum = parseInt(numberRange);

    rooms[roomId] = {
      roomId: roomId,
      maxPlayers: parseInt(playersCount),
      numberRange: rangeNum,
      players: [],
      // إنشاء مصفوفة بالأرقام المتاحة من 1 إلى الرينج المخصص
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
      maxPlayers: playersCount,
      players: rooms[roomId].players,
    });
  });

  // 2. انضمام لاعب للغرفة
  socket.on("joinRoom", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("errorMsg", "الغرفة غير موجودة!");
    if (room.players.length >= room.maxPlayers)
      return socket.emit("errorMsg", "الغرفة ممتلئة!");

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
        name: name,
        isHost: false,
        isReady: true,
        score: 0,
      };
      room.players.push(player);
    } else {
      player.name = name;
      player.isReady = true;
    }

    io.to(roomId).emit("updateLobby", {
      players: room.players,
      maxPlayers: room.maxPlayers,
    });
  });

  // 4. بدء اللعبة بواسطة المضيف
  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.isGameStarted = true;
    startNewRound(roomId);
  });

  // 5. استقبال رقم القائد والتحقق من النطاق والأرقام السابقة
  socket.on("submitLeaderNumber", ({ roomId, chosenNumber }) => {
    const room = rooms[roomId];
    if (!room) return;

    const num = parseInt(chosenNumber);

    // أ) التحقق من وجود الرقم ومدى صحته
    if (isNaN(num)) {
      return socket.emit("errorMsg", "يرجى إدخال رقم صحيح!");
    }

    // ب) التحقق من أن الرقم داخل النطاق المسموح (من 1 إلى numberRange)
    if (num < 1 || num > room.numberRange) {
      return socket.emit(
        "errorMsg",
        `عذراً، يجب اختيار رقم بين 1 و ${room.numberRange}`,
      );
    }

    // جـ) التحقق مما إذا كان الرقم قد تم اختياره سابقاً
    if (!room.availableNumbers.includes(num)) {
      return socket.emit(
        "errorMsg",
        "هذا الرقم تم اختياره سابقاً! اختر رقماً آخر.",
      );
    }

    // قبول الرقم وتخزينه
    room.targetNumber = num;
    socket.emit("leaderNumberAccepted");

    // إرسال أول سؤال للقائد
    sendNextQuestion(socket);

    // إطلاق إشعار للصيادين لبدء البحث
    io.to(roomId).emit("startHunting", {
      targetNumber: room.targetNumber,
      numberRange: room.numberRange,
      foundNumbers: [],
    });

    // بدء العد التنازلي للبحث (30 ثانية)
    startRoundTimer(roomId);
  });

  // 6. إجابة القائد على السؤال (1 نقطة لكل إجابة صحيحة)
  socket.on("answerTrivia", ({ roomId, selectedOption }) => {
    const room = rooms[roomId];
    if (!room) return;

    const leader = room.players[room.leaderIndex];
    const isCorrect = selectedOption === socket.currentCorrectAnswer;

    if (isCorrect) {
      leader.score += 1;
    }

    socket.emit("triviaResult", {
      success: isCorrect,
      newScore: leader.score,
    });

    // إرسال السؤال التالي إذا كان الوقت مستمراً
    if (room.timeLeft > 0) {
      sendNextQuestion(socket);
    }
  });

  // 7. صيد الرقم من قبل الصياد (10 للأول، 7 للثاني، 5 للثالث، 2 للبقية)
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
      });
    }

    // تحديث دوائر التقدم لدى القائد
    const leader = room.players[room.leaderIndex];
    if (leader) {
      io.to(leader.id).emit("updateHuntersProgress", {
        totalHunters: room.players.length - 1,
        foundCount: room.foundHunters.length,
      });
    }

    // إذا أوجد جميع الصيادين الرقم، إنهاء الدور فوراً
    if (room.foundHunters.length >= room.players.length - 1) {
      clearInterval(room.timer);
      endRound(roomId);
    }
  });

  socket.on("disconnect", () => {
    // إدارة خروج اللاعبين...
  });
});

// === الدوال المساعدة في السيرفر ===

function startNewRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // استبعاد الرقم المستخدم في الجولة السابقة بشكل دائم من قائمة المتاح
  if (room.targetNumber) {
    room.availableNumbers = room.availableNumbers.filter(
      (n) => n !== room.targetNumber,
    );
  }

  // التحقق من انتهاء جميع الأرقام المتاحة لإسدال الستار على اللعبة
  if (room.availableNumbers.length === 0) {
    return handleGameOver(roomId);
  }

  room.foundHunters = [];
  room.targetNumber = null;
  room.timeLeft = 30;

  const leaderPlayer = room.players[room.leaderIndex];

  // إرسال كود البداية مع استمرار تتبع الأرقام المتاحة واسم القائد
  room.players.forEach((p) => {
    const isLeader = p.id === leaderPlayer.id;
    io.to(p.id).emit("roundStarted", {
      isLeader: isLeader,
      leaderName: leaderPlayer.name || "القائد", // تمرير اسم القائد الحالي
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

  // خلط الخيارات الأربعة عشوائياً
  const shuffledOptions = [...q.options].sort(() => Math.random() - 0.5);

  socket.emit("sendTriviaQuestion", {
    question: q.question,
    options: shuffledOptions,
  });
}

function endRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // نقل دور القائد للاعب التالي
  room.leaderIndex = (room.leaderIndex + 1) % room.players.length;

  io.to(roomId).emit("showTurnTransition", { countdown: 5 });

  setTimeout(() => {
    startNewRound(roomId);
  }, 5000);
}

function handleGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // ترتيب اللاعبين حسب النقاط
  const leaderboard = [...room.players].sort((a, b) => b.score - a.score);

  io.to(roomId).emit("gameOver", { leaderboard: leaderboard });
  delete rooms[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
