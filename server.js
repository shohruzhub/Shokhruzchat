const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const db = new Database("shokhruz-chat.db");

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE IF NOT EXISTS chats ( id INTEGER PRIMARY KEY AUTOINCREMENT, user1_id INTEGER NOT NULL, user2_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user1_id, user2_id) );
  CREATE INDEX IF NOT EXISTS messages_pair
  ON messages(sender_id, receiver_id, id);
`);

function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "You are not logged in."
      });
    }

    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);

    next();
  } catch {
    res.status(401).json({
      error: "Your session has expired. Please log in again."
    });
  }
}

app.get("/api/check-username", (req, res) => {
  const username = String(req.query.username || "").trim();

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.json({
      valid: false,
      available: false,
      message:
        "Username must be 3–20 characters and use only letters, numbers, or underscores."
    });
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  res.json({
    valid: true,
    available: !existing,
    message: existing
      ? "Username already taken."
      : "Username is available!"
  });
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      error:
        "Username must be 3–20 characters and use only letters, numbers, or underscores."
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: "Password must be at least 6 characters."
    });
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  if (existing) {
    return res.status(409).json({
      error: "Username already taken."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)"
      )
      .run(username, passwordHash);

    const userId = Number(result.lastInsertRowid);

    const token = jwt.sign(
      {
        id: userId,
        username
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      userId,
      username
    });
  } catch {
    res.status(409).json({
      error: "Username already taken."
    });
  }
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);

  if (!user) {
    return res.status(401).json({
      error: "Incorrect username or password."
    });
  }

  const correctPassword = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!correctPassword) {
    return res.status(401).json({
      error: "Incorrect username or password."
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    userId: user.id,
    username: user.username
  });
});

app.get("/api/users/:username", authenticate, (req, res) => {
  const username = String(req.params.username || "").trim();

  const user = db
    .prepare("SELECT id, username FROM users WHERE username = ?")
    .get(username);

  if (!user) {
    return res.status(404).json({
      error: "User not found."
    });
  }

  if (user.id === req.user.id) {
    return res.status(400).json({
      error: "You cannot chat with yourself."
    });
  }

  res.json(user);
});

app.get("/api/messages/:username", authenticate, (req, res) => {
  const other = db
    .prepare("SELECT id, username FROM users WHERE username = ?")
    .get(req.params.username);

  if (!other) {
    return res.status(404).json({
      error: "User not found."
    });
  }

  const messages = db
    .prepare(`
      SELECT
        id,
        sender_id AS senderId,
        receiver_id AS receiverId,
        body,
        created_at AS createdAt
      FROM messages
      WHERE
        (sender_id = ? AND receiver_id = ?)
        OR
        (sender_id = ? AND receiver_id = ?)
      ORDER BY id ASC
      LIMIT 500
    `)
    .all(
      req.user.id,
      other.id,
      other.id,
      req.user.id
    );

  res.json({
    user: other,
    messages
  });
});

app.post("/api/messages", authenticate, (req, res) => {
  const username = String(req.body.username || "").trim();
  const body = String(req.body.body || "").trim();

  if (!body) {
    return res.status(400).json({
      error: "Message cannot be empty."
    });
  }

  if (body.length > 2000) {
    return res.status(400).json({
      error: "Message is too long."
    });
  }

  const receiver = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  if (!receiver) {
    return res.status(404).json({
      error: "User not found."
    });
  }

  if (receiver.id === req.user.id) {
    return res.status(400).json({
      error: "You cannot message yourself."
    });
  }

  const result = db
    .prepare(`
      INSERT INTO messages
      (sender_id, receiver_id, body)
      VALUES (?, ?, ?)
    `)
    .run(
      req.user.id,
      receiver.id,
      body
    );

  const message = db
    .prepare(`
      SELECT
        id,
        sender_id AS senderId,
        receiver_id AS receiverId,
        body,
        created_at AS createdAt
      FROM messages
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);

  res.json(message);
});

app.listen(PORT, () => {
  console.log(`Shokhruz Chat running on port ${PORT}`);
});
