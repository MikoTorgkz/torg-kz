const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 8080;

// база
const db = new sqlite3.Database("database.db");

// создаём таблицу
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  password TEXT
)
`);

app.use(express.json());
app.use(express.static(__dirname));

// регистрация
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  db.run(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, password],
    (err) => {
      if (err) {
        return res.send("Ошибка");
      }
      res.send("OK");
    }
  );
});

// тест
app.get("/test", (req, res) => {
  res.send("TEST OK");
});

// главная
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER WORKING");
});